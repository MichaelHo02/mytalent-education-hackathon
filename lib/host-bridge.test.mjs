import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

// Exercise the real MCP Apps SDK over an in-process postMessage host. This checks
// transport behavior, not whether the installed Codex app grants these capabilities.
let sequence = 0;
function mockHost({ failFirstConnection = false, rejectMessage = false, messaging = "extension", modelContext = false, rejectContext = false } = {}) {
  const originals = new Map(["window", "document", "ResizeObserver", "requestAnimationFrame", "cancelAnimationFrame"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const requests = [];
  const statuses = [];
  const updates = [];
  let connections = 0;
  const window = new EventTarget();
  const style = { setProperty() {}, getPropertyValue() { return ""; }, removeProperty() {} };
  const element = { style, classList: { toggle() {} }, getBoundingClientRect() { return { width: 360, height: 640 }; } };
  function deliver(data) {
    const event = new Event("message");
    Object.assign(event, { data, source: window.parent });
    window.dispatchEvent(event);
  }
  window.parent = {
    postMessage(message) {
      requests.push(message);
      if (message.id === undefined) return;
      let result;
      let error;
      if (message.method === "ui/initialize") {
        connections++;
        if (failFirstConnection && connections === 1) error = { code: -32603, message: "Temporary host failure" };
        else result = {
          protocolVersion: "2026-01-26",
          hostInfo: { name: "test-host", version: "1" },
          hostCapabilities: {
            serverTools: {}, downloadFile: {},
            experimental: { ...(messaging === "extension" ? { "openai/message": {} } : {}), ...(modelContext ? { "openai/modelContext": {} } : {}) },
            ...(messaging === "standard" ? { message: { text: {} } } : {}),
            ...(modelContext ? { updateModelContext: { text: {} } } : {}),
          },
          hostContext: {},
        };
      } else if (message.method === "ui/update-model-context") {
        if (rejectContext) error = { code: -32603, message: "Context unavailable" };
        else result = { _meta: { "openai/modelContext": { updateId: `context-${message.id}` } } };
      } else if (message.method === "ui/message") result = rejectMessage ? { isError: true } : {};
      else if (message.method === "tools/call") {
        const body = { state: { tests: [], submissions: [], activities: [], followups: [] } };
        result = { content: [], structuredContent: { status: 200, body, headers: { "content-type": "application/json" } } };
      } else if (message.method === "ui/download-file") result = {};
      else error = { code: -32601, message: `Unsupported mock method: ${message.method}` };
      queueMicrotask(() => deliver({ jsonrpc: "2.0", id: message.id, ...(error ? { error } : { result }) }));
    },
  };
  window.__TUTOR_MCP_APP__ = true;
  window.innerWidth = 360;
  window.addEventListener("tutor:host-status", event => statuses.push(event.detail));
  window.addEventListener("tutor:data-changed", event => updates.push(event.detail));
  Object.assign(globalThis, {
    window,
    document: { documentElement: element, body: element },
    ResizeObserver: class { observe() {} disconnect() {} },
    // Layout notifications are unrelated to this transport check. Leave frames
    // unscheduled so the SDK cannot emit a size notification after app.close().
    requestAnimationFrame: () => 0,
    cancelAnimationFrame() {},
  });
  return {
    requests, statuses, updates, window,
    notifyToolResult: structuredContent => deliver({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: { content: [], structuredContent } }),
    restore() {
      for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      }
    },
  };
}

async function loadBridge() {
  return import(`./host-bridge.ts?test=${++sequence}`);
}

test("a failed host handshake can reconnect and transport saved workspace results", async () => {
  const host = mockHost({ failFirstConnection: true });
  let connection;
  try {
    const bridge = await loadBridge();
    await assert.rejects(bridge.initializeHostBridge(), /Temporary host failure/);
    assert.equal(bridge.getHostState(), "error");
    assert.equal(bridge.canSendHostPrompt(), true);
    connection = await bridge.initializeHostBridge();
    assert.equal(bridge.getHostState(), "ready");
    assert.equal(host.requests.filter(request => request.method === "ui/initialize").length, 2);
    const response = await bridge.requestApi("/api/workspace");
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).state.submissions, []);
    const saved = { body: { submission: { id: "new-paper" } } };
    host.notifyToolResult(saved);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(host.updates.at(-1), saved);
  } finally {
    await connection?.app.close();
    await new Promise(resolve => setImmediate(resolve));
    host.restore();
  }
});

test("finish uses real host messaging, coalesces duplicate clicks and reports feedback status", async () => {
  const host = mockHost();
  let connection;
  try {
    const bridge = await loadBridge();
    connection = await bridge.initializeHostBridge();
    const prompt = bridge.finishPrompt("approved-paper", "2026-10-13");
    const first = bridge.sendHostPrompt(prompt, "finish");
    const duplicate = bridge.sendHostPrompt(prompt, "finish");
    assert.equal(first, duplicate);
    await first;
    const messages = host.requests.filter(request => request.method === "ui/message");
    assert.equal(messages.length, 1);
    assert.equal(messages[0].params.role, "user");
    assert.equal(messages[0].params.content[0].text, prompt);
    assert.equal(host.statuses.at(-1).status, "sent");
    assert.equal(host.statuses.at(-1).action, "finish");
    assert.match(host.statuses.at(-1).message, /student, parent and manager feedback/);
    await bridge.downloadFile("/api/export?kind=marking", "exhibit-1.csv");
    assert.equal(host.requests.filter(request => request.method === "ui/download-file").length, 1);
  } finally {
    await connection?.app.close();
    await new Promise(resolve => setImmediate(resolve));
    host.restore();
  }
});

test("standard message hosts work and rejected messages retain a copyable prompt", async () => {
  const host = mockHost({ messaging: "standard", rejectMessage: true });
  let connection;
  try {
    const bridge = await loadBridge();
    connection = await bridge.initializeHostBridge();
    const prompt = bridge.uploadPrompt();
    await assert.rejects(bridge.sendHostPrompt(prompt, "upload"), /rejected/);
    assert.equal(host.requests.filter(request => request.method === "ui/message").length, 1);
    assert.equal(host.statuses.at(-1).status, "error");
    assert.equal(host.statuses.at(-1).prompt, prompt);
    assert.equal(host.statuses.at(-1).action, "upload");
  } finally {
    await connection?.app.close();
    await new Promise(resolve => setImmediate(resolve));
    host.restore();
  }
});

test("hosts without messaging leave the guided request available for manual handoff", async () => {
  const host = mockHost({ messaging: "none" });
  let connection;
  try {
    const bridge = await loadBridge();
    connection = await bridge.initializeHostBridge();
    assert.equal(bridge.canSendHostPrompt(), false);
    await assert.rejects(bridge.sendHostPrompt("Prepared request", "admin"), /cannot send messages/);
    assert.equal(host.statuses.at(-1).prompt, "Prepared request");
    assert.equal(host.requests.filter(request => request.method === "ui/message").length, 0);
  } finally {
    await connection?.app.close();
    await new Promise(resolve => setImmediate(resolve));
    host.restore();
  }
});

test("documented background context hides workflow details and stays paired with short action messages", async () => {
  const host = mockHost({ modelContext: true });
  let connection;
  try {
    const bridge = await loadBridge();
    connection = await bridge.initializeHostBridge();
    const prompts = [bridge.uploadPrompt(), bridge.finishPrompt("approved-paper", "2026-10-13")];
    await Promise.all([bridge.sendHostPrompt(prompts[0], "upload"), bridge.sendHostPrompt(prompts[1], "finish")]);
    const deliveries = host.requests.filter(request => ["ui/update-model-context", "ui/message"].includes(request.method));
    assert.deepEqual(deliveries.map(request => request.method), ["ui/update-model-context", "ui/message", "ui/update-model-context", "ui/message"]);
    for (const index of [0, 1]) {
      const context = deliveries[index * 2].params.content[0];
      assert.deepEqual(context.annotations.audience, ["assistant"]);
      assert.ok(context.text.endsWith(prompts[index]));
      const message = deliveries[index * 2 + 1].params;
      assert.equal(message.role, "user");
      assert.ok(message.content[0].text.length < 150);
      assert.doesNotMatch(message.content[0].text, /get_submission|expectedRevision|save_marking_draft/);
    }
    assert.match(deliveries[1].params.content[0].text, /complete student paper and its rubric/);
    assert.match(deliveries[3].params.content[0].text, /all three exhibits.*student, parent and manager/);
  } finally {
    await connection?.app.close();
    await new Promise(resolve => setImmediate(resolve));
    host.restore();
  }
});

test("a rejected context update sends the complete request instead of losing grading constraints", async () => {
  const host = mockHost({ modelContext: true, rejectContext: true });
  let connection;
  try {
    const bridge = await loadBridge();
    connection = await bridge.initializeHostBridge();
    const prompt = bridge.uploadPrompt();
    await bridge.sendHostPrompt(prompt, "upload");
    assert.equal(host.requests.find(request => request.method === "ui/message").params.content[0].text, prompt);
    assert.equal(host.statuses.at(-1).status, "sent");
  } finally {
    await connection?.app.close();
    await new Promise(resolve => setImmediate(resolve));
    host.restore();
  }
});

test("marking prompts and skill require uploaded rubric and full scope before records or scoring", async () => {
  const bridge = await loadBridge();
  for (const prompt of [bridge.uploadPrompt(), bridge.uploadPrompt("historical-test"), bridge.markingPrompt("current-submission")]) {
    assert.match(prompt, /tutor-uploaded rubric is required/i);
    assert.match(prompt, /No default, seeded or saved-guide fallback/);
    assert.match(prompt, /before creating or scoring a submission/);
    assert.match(prompt, /beyond Q1–3/);
    assert.match(prompt, /Never silently mark a subset/);
    assert.match(prompt, /Do not call open_tutor_workspace/);
  }
  const upload = bridge.uploadPrompt();
  assert.match(upload, /rubricAttachmentNames.*actual uploaded rubric filenames/);
  assert.match(upload, /paperQuestionIds.*independently observed full-paper inventory/);
  assert.match(upload, /Never use placeholder student names or dates/);
  assert.match(upload, /never substitute today's date for an unknown test date/);
  assert.ok(upload.indexOf("first ask for clear photos") < upload.indexOf("ask for the required rubric upload"));
  assert.ok(upload.indexOf("ask for the required rubric upload") < upload.indexOf("finally ask for only the missing student alias"));
  const finish = bridge.finishPrompt("approved-paper", "2026-10-13");
  assert.match(finish, /do not ask for another confirmation, generation click or manual report entry/);
  assert.match(finish, /Prepare and save all three/);
  assert.match(finish, /For EACH audience call get_conversation_evidence/);
  assert.match(finish, /Save each draft with save_conversation_brief/);
  assert.match(finish, /every returned requiredEvidenceRef and requiredSourceRevision/);
  assert.match(finish, /every paper approved on the Melbourne reporting date and every activity ID/);
  assert.match(finish, /stop if it does not/);
  const skill = await fs.readFile(new URL("../plugin-overlay/skills/tutor-workflow/SKILL.md", import.meta.url), "utf8");
  assert.match(skill, /No default, seeded or saved-guide fallback/);
  assert.match(skill, /paperQuestionIds/);
  assert.match(skill, /rubricAttachmentNames/);
  assert.match(skill, /Do not call `open_tutor_workspace`/);
  assert.match(skill, /Approval requests completion immediately/);
});
