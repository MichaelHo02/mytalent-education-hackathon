import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { OpenAIUiToolMetadataSchema } from "@openai/mcp-extensions/server";
import { calendarDate, generateBriefs, today, validateDate } from "../../lib/domain.ts";

// Exercise the actual route while isolating Next/Cloudflare identity and storage.
// Modern required fields follow the official 2026-07-28 schema's Result,
// CacheableResult and DiscoverResult definitions:
// https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2026-07-28/schema.ts
const source = await fs.readFile(new URL("./route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  transformers: { before: [context => file => {
    const visit = node => {
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword &&
          ts.isStringLiteral(node.arguments[0]) && ["../api/tests/route", "../api/chat-submissions/route"].includes(node.arguments[0].text)) {
        return ts.factory.createIdentifier("stubMutationRoute");
      }
      return ts.visitEachChild(node, visit, context);
    };
    return ts.visitNode(ts.factory.updateSourceFile(file, file.statements.filter(statement => !ts.isImportDeclaration(statement))), visit);
  }] },
}).outputText;
const dependencies = `
const MCP_APP_HTML = '<!doctype html><title>MyTalent Education</title>';
async function getChatGPTUser(){ return globalThis.__tutorProtocolTest.user; }
async function readWorkspace(owner){ globalThis.__tutorProtocolTest.owners.push(owner); return globalThis.__tutorProtocolTest.state; }
const {calendarDate, generateBriefs, today, validateDate}=globalThis.__tutorProtocolHelpers;
const stubMutationRoute = { async POST(request) { return Response.json({received:await request.json()}); } };
`;
globalThis.__tutorProtocolHelpers = { calendarDate, generateBriefs, today, validateDate };
const { POST } = await import("data:text/javascript;base64," + Buffer.from(dependencies + compiled).toString("base64"));
const modernVersion = "2026-07-28";
const modernMeta = {
  "io.modelcontextprotocol/protocolVersion": modernVersion,
  "io.modelcontextprotocol/clientInfo": { name: "protocol-test", version: "1" },
  "io.modelcontextprotocol/clientCapabilities": {},
};
let requestId = 0;
function context(user = null, state = {tests:[],submissions:[],activities:[],followups:[]}) { globalThis.__tutorProtocolTest = { user, owners: [], state }; }
async function rpc(method, params = {}, headers = {}) {
  const response = await POST(new Request("https://workspace.local/mcp", {
    method: "POST", headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method, params }),
  }));
  return { status: response.status, ...(await response.json()) };
}
function modernRpc(method, params = {}) {
  return rpc(method, { ...params, _meta: modernMeta }, { "MCP-Protocol-Version": modernVersion });
}
function checkModernResult(result, cacheable) {
  assert.equal(result.resultType, "complete");
  assert.equal(result._meta["io.modelcontextprotocol/serverInfo"].name, "tutor-workspace");
  assert.equal(result._meta["io.modelcontextprotocol/serverInfo"].title, "MyTalent Education");
  assert.equal(result._meta["io.modelcontextprotocol/serverInfo"].version, "0.2.0");
  if (cacheable) {
    assert.equal(result.ttlMs, 0);
    assert.equal(result.cacheScope, "public");
  } else {
    assert.equal(result.ttlMs, undefined);
    assert.equal(result.cacheScope, undefined);
  }
}

test("modern discovery has its own schema and exposes the UI capability without reading tutor data", async () => {
  context();
  for (const response of [await modernRpc("server/discover"), await rpc("server/discover")]) {
    assert.equal(response.status, 200);
    checkModernResult(response.result, true);
    assert.ok(response.result.supportedVersions.includes(modernVersion));
    assert.deepEqual(response.result.capabilities.extensions["io.modelcontextprotocol/ui"], {});
    assert.equal(response.result.protocolVersion, undefined);
    assert.equal(response.result.serverInfo, undefined);
  }
  assert.deepEqual(globalThis.__tutorProtocolTest.owners, []);
});

test("per-request versions preserve both entrypoints and complete modern list/resource envelopes", async () => {
  context();
  const list = await modernRpc("tools/list");
  checkModernResult(list.result, true);
  const entrypoint = list.result.tools.find(tool => tool.name === "open_tutor_workspace");
  OpenAIUiToolMetadataSchema.parse(entrypoint._meta["openai/ui"]);
  assert.deepEqual(entrypoint._meta["openai/ui"].entrypoints, [{ type: "global" }, { type: "thread" }]);
  assert.equal(entrypoint._meta.ui.resourceUri, "ui://tutor/workspace");
  assert.deepEqual(list.result.tools.filter(tool => tool._meta?.ui?.resourceUri).map(tool => tool.name), ["open_tutor_workspace"]);
  for (const tool of list.result.tools.filter(tool => tool.name !== "open_tutor_workspace")) {
    assert.equal(tool._meta?.["openai/ui"]?.entrypoints, undefined);
  }
  for (const [method, params] of [["resources/list", {}], ["resources/templates/list", {}], ["resources/read", { uri: "ui://tutor/workspace" }]]) {
    const response = await modernRpc(method, params);
    checkModernResult(response.result, true);
  }
  const headerOnly = await rpc("tools/list", {}, { "MCP-Protocol-Version": modernVersion });
  checkModernResult(headerOnly.result, true);
});

test("creation tools require rubric provenance and full-paper inventory and forward both to storage", async () => {
  context({ userId: "signed-in-tutor" });
  const discovery = await modernRpc("server/discover");
  assert.match(discovery.result.instructions, /no default or saved-guide fallback/);
  assert.match(discovery.result.instructions, /never call open_tutor_workspace/);
  const { result: { tools } } = await modernRpc("tools/list");
  const testTool = tools.find(tool => tool.name === "create_test");
  assert.ok(testTool.inputSchema.required.includes("rubricAttachmentNames"));
  assert.ok(testTool.inputSchema.required.includes("markIncrement"));
  const submissionTool = tools.find(tool => tool.name === "create_chat_submission");
  assert.ok(submissionTool.inputSchema.required.includes("paperQuestionIds"));
  const rubric = { title: "Uploaded paper", guideText: "rubric.pdf pages 1–2", rubricAttachmentNames: ["rubric.pdf"], markIncrement: 1, questions: [{ id: "Q4b", topic: "Algebra", maxMarks: 3, criteria: "Uploaded criteria" }] };
  const createdTest = await modernRpc("tools/call", { name: "create_test", arguments: rubric });
  assert.deepEqual(createdTest.result.structuredContent.body.received, rubric);
  const paper = { testId: "uploaded-test", studentName: "Supplied alias", date: "2026-10-13", attachmentNames: ["paper.pdf"], paperQuestionIds: ["Q4b"] };
  const createdPaper = await modernRpc("tools/call", { name: "create_chat_submission", arguments: paper });
  assert.deepEqual(createdPaper.result.structuredContent.body.received, {
    testId: paper.testId, studentName: paper.studentName, date: paper.date,
    chatAttachmentNames: paper.attachmentNames, paperQuestionIds: paper.paperQuestionIds,
  });
});

test("modern tool calls retain signed-in authorization and never advertise public caching", async () => {
  context();
  const denied = await modernRpc("tools/call", { name: "get_workspace", arguments: {} });
  checkModernResult(denied.result, false);
  assert.equal(denied.result.isError, true);
  assert.equal(denied.result.structuredContent, undefined);
  assert.deepEqual(globalThis.__tutorProtocolTest.owners, []);
  context({ userId: "signed-in-tutor", email: "tutor@example.test", displayName: "Tutor" });
  const approved = await modernRpc("tools/call", { name: "get_workspace", arguments: {} });
  checkModernResult(approved.result, false);
  assert.ok(approved.result.structuredContent.state);
  assert.deepEqual(globalThis.__tutorProtocolTest.owners, ["signed-in-tutor"]);
});

test("manager evidence specifies all daily papers and activities using Melbourne approval dates", async () => {
  const submission = (id, approvedAt, revision) => ({ id, testId: "test", studentName: id, status: "approved", approvedAt, revision, questions: [{ questionId: "Q1" }] });
  context({ userId: "signed-in-tutor" }, {
    tests: [], followups: [],
    submissions: [submission("first", "2026-10-12T14:00:00Z", 2), submission("second", "2026-10-13T01:00:00Z", 4), submission("previous", "2026-10-12T01:00:00Z", 3)],
    activities: [{ id: "contact", date: "2026-10-13", type: "parent_contact", count: 1 }, { id: "attendance", date: "2026-10-13", type: "attendance", count: 2 }, { id: "yesterday", date: "2026-10-12", type: "qa", count: 1 }],
  });
  const response = await modernRpc("tools/call", { name: "get_conversation_evidence", arguments: { audience: "manager", date: "2026-10-13" } });
  const evidence = response.result.structuredContent;
  assert.deepEqual(evidence.requiredEvidenceRefs, ["first", "second", "contact", "attendance"]);
  assert.deepEqual(evidence.requiredSourceRevisions, { first: 2, second: 4 });
  assert.equal(evidence.briefs.manager.papersMarked, 2);
  assert.ok(evidence.evidenceRefs.includes("first:Q1"));
  assert.ok(evidence.evidenceRefs.includes("first"));
  assert.equal(evidence.evidenceRefs.includes("yesterday"), false);
});

test("unsupported and mismatched request versions fail before reading private records", async () => {
  context({ userId: "signed-in-tutor" });
  const unsupported = await rpc("tools/call", { name: "get_workspace", arguments: {}, _meta: { ...modernMeta, "io.modelcontextprotocol/protocolVersion": "2099-01-01" } }, { "MCP-Protocol-Version": "2099-01-01" });
  assert.equal(unsupported.status, 400);
  assert.equal(unsupported.error.code, -32022);
  assert.equal(unsupported.error.data.requested, "2099-01-01");
  assert.ok(unsupported.error.data.supported.includes(modernVersion));
  const mismatch = await rpc("tools/call", { name: "get_workspace", arguments: {}, _meta: modernMeta }, { "MCP-Protocol-Version": "2025-11-25" });
  assert.equal(mismatch.status, 400);
  assert.equal(mismatch.error.code, -32020);
  assert.deepEqual(globalThis.__tutorProtocolTest.owners, []);
});
