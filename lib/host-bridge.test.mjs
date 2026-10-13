import assert from "node:assert/strict";
import test from "node:test";

// Exercise the real MCP Apps SDK over an in-process postMessage host. This checks
// transport behavior, not whether the installed Codex app grants these capabilities.
let sequence = 0;
function mockHost({ failFirstConnection = false, rejectMessage = false, messaging = "extension" } = {}) {
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
            ...(messaging === "extension" ? { experimental: { "openai/message": {} } } : messaging === "standard" ? { message: { text: {} } } : {}),
          },
          hostContext: {},
        };
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
