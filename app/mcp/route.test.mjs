import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { OpenAIUiToolMetadataSchema } from "@openai/mcp-extensions/server";

// Exercise the actual route while isolating Next/Cloudflare identity and storage.
// Modern required fields follow the official 2026-07-28 schema's Result,
// CacheableResult and DiscoverResult definitions:
// https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/schema/2026-07-28/schema.ts
const source = await fs.readFile(new URL("./route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  transformers: { before: [() => file => ts.factory.updateSourceFile(file, file.statements.filter(statement => !ts.isImportDeclaration(statement)))] },
}).outputText;
const dependencies = `
const MCP_APP_HTML = '<!doctype html><title>MyTalent Education</title>';
async function getChatGPTUser(){ return globalThis.__tutorProtocolTest.user; }
async function readWorkspace(owner){ globalThis.__tutorProtocolTest.owners.push(owner); return {tests:[],submissions:[],activities:[],followups:[]}; }
`;
const { POST } = await import("data:text/javascript;base64," + Buffer.from(dependencies + compiled).toString("base64"));
const modernVersion = "2026-07-28";
const modernMeta = {
  "io.modelcontextprotocol/protocolVersion": modernVersion,
  "io.modelcontextprotocol/clientInfo": { name: "protocol-test", version: "1" },
  "io.modelcontextprotocol/clientCapabilities": {},
};
let requestId = 0;
function context(user = null) { globalThis.__tutorProtocolTest = { user, owners: [] }; }
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
  for (const [method, params] of [["resources/list", {}], ["resources/templates/list", {}], ["resources/read", { uri: "ui://tutor/workspace" }]]) {
    const response = await modernRpc(method, params);
    checkModernResult(response.result, true);
  }
  const headerOnly = await rpc("tools/list", {}, { "MCP-Protocol-Version": modernVersion });
  checkModernResult(headerOnly.result, true);
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
