import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// Isolate framework/storage dependencies; exercise the actual route helper source.
const source = await fs.readFile(new URL("./_shared.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  transformers: { before: [() => file => ts.factory.updateSourceFile(file, file.statements.filter(statement => !ts.isImportDeclaration(statement)))] },
}).outputText;
const dependencies = `
class WorkspaceError extends Error { constructor(message,status=400){ super(message); this.status=status; } }
async function headers(){ return globalThis.__tutorAuthTest.headers; }
async function getChatGPTUser(){ return globalThis.__tutorAuthTest.user; }
async function getFile(){ throw new Error('Not used in authentication checks.'); }
`;
const { authenticated, multipartPayload, payload, readRequestText } = await import("data:text/javascript;base64," + Buffer.from(dependencies + compiled).toString("base64"));
function context(cookie = "", user = null) { globalThis.__tutorAuthTest = { headers: new Headers(cookie ? { cookie } : {}), user }; }
const action = async user => Response.json({ owner: user.userId, name: user.displayName });
const bootstrap = { allowGuestCreation: true, requestUrl: "https://tutor.example/api/workspace" };
function cookie(response) { return response.headers.get("set-cookie").split(";")[0]; }

test("anonymous workspace bootstrap issues an opaque secured cookie and isolated hashed owner", async () => {
  context(); const response = await authenticated(action, bootstrap); const record = await response.json(); const value = response.headers.get("set-cookie");
  assert.equal(response.status, 200); assert.match(value, /^tutor_guest=[0-9a-f]{64};/);
  for (const flag of ["HttpOnly", "SameSite=Lax", "Path=/", "Max-Age=2592000", "Secure"]) assert.ok(value.includes(flag));
  assert.match(record.owner, /^guest:[0-9a-f]{64}$/); assert.equal(record.name, "Guest");
  assert.notEqual(record.owner.slice(6), cookie(response).split("=")[1]);
});
test("a guest cookie preserves the same owner while a second visitor gets a separate owner", async () => {
  context(); const first = await authenticated(action, bootstrap); const firstOwner = (await first.json()).owner; const firstCookie = cookie(first);
  context(firstCookie); const again = await authenticated(action); assert.equal((await again.json()).owner, firstOwner); assert.equal(again.headers.get("set-cookie"), null);
  context(); const second = await authenticated(action, bootstrap); assert.notEqual((await second.json()).owner, firstOwner); assert.notEqual(cookie(second), firstCookie);
});
test("writes without a valid guest session fail before touching records", async () => {
  for (const value of ["", "tutor_guest=some-other-owner", "tutor_guest=" + "a".repeat(63), "tutor_guest=" + "g".repeat(64)]) {
    context(value); let called = false; const response = await authenticated(async () => { called = true; return Response.json({}); });
    assert.equal(response.status, 401); assert.equal(called, false); assert.match((await response.json()).error, /Reload the workspace/); assert.equal(response.headers.get("set-cookie"), null);
  }
});
test("ChatGPT identity takes priority over a guest cookie and never sets anonymous credentials", async () => {
  context("tutor_guest=" + "a".repeat(64), { userId: "signed-in-test-owner", displayName: "Tutor", email: "tutor@example.test", fullName: null });
  const response = await authenticated(action, bootstrap); assert.equal((await response.json()).owner, "signed-in-test-owner"); assert.equal(response.headers.get("set-cookie"), null);
});
test("HTTP loopback preview can retain its guest cookie without the Secure flag", async () => {
  context(); const response = await authenticated(action, { ...bootstrap, requestUrl: "http://127.0.0.1:5173/api/workspace" });
  assert.ok(!response.headers.get("set-cookie").includes("Secure")); assert.ok(response.headers.get("set-cookie").includes("HttpOnly"));
});
test("bounded multipart parser preserves uploaded fields and rejects oversized streams", async () => {
  const form = new FormData(); form.set("testId", "test"); form.append("files", new File([new Uint8Array([137, 80, 78, 71])], "page.png", { type: "image/png" }));
  const parsed = await multipartPayload(new Request("https://workspace.local/api/submissions", { method: "POST", body: form }), 1024);
  assert.equal(parsed.get("testId"), "test"); assert.equal(parsed.get("files").name, "page.png");
  const large = new FormData(); large.set("data", "x".repeat(4096));
  await assert.rejects(() => multipartPayload(new Request("https://workspace.local", { method: "POST", body: large }), 1024), error => error.status === 413);
});
test("JSON size limit covers streaming bodies without Content-Length", async () => {
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("x".repeat(4096))); controller.close(); } });
  await assert.rejects(() => readRequestText(new Request("https://workspace.local", { method: "POST", body: stream, duplex: "half" }), 1024), error => error.status === 413);
  assert.deepEqual(await payload(new Request("https://workspace.local", { method: "POST", body: '{"test":true}' })), { test: true });
});
