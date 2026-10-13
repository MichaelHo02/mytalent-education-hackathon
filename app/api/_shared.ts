import { getChatGPTUser, type ChatGPTUser } from "../chatgpt-auth";
import { headers } from "next/headers";
import { WorkspaceError } from "@/lib/domain";
import { getFile } from "@/lib/store";

export function json(value: unknown, status = 200): Response { return Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } }); }
export async function readRequestText(request: Request, maxBytes: number): Promise<string> {
  if (Number(request.headers.get("content-length")) > maxBytes) throw new WorkspaceError("The request is too large.", 413);
  if (!request.body) return "";
  const reader = request.body.getReader(); const decoder = new TextDecoder(); const chunks: string[] = []; let bytes = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > maxBytes) { await reader.cancel().catch(() => undefined); throw new WorkspaceError("The request is too large.", 413); }
      chunks.push(decoder.decode(part.value, { stream: true }));
    }
    chunks.push(decoder.decode()); return chunks.join("");
  } finally { reader.releaseLock(); }
}
export async function multipartPayload(request: Request, maxBytes: number): Promise<FormData> {
  if (Number(request.headers.get("content-length")) > maxBytes) throw new WorkspaceError("Upload at most 20 MB per submission.", 413);
  if (!request.body) throw new WorkspaceError("Provide files as a multipart upload.");
  let bytes = 0; let exceeded = false;
  const stream = request.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, controller) {
    bytes += chunk.byteLength;
    if (bytes > maxBytes) { exceeded = true; throw new WorkspaceError("Upload at most 20 MB per submission.", 413); }
    controller.enqueue(chunk);
  } }));
  try { return await new Response(stream, { headers: { "Content-Type": request.headers.get("content-type") ?? "" } }).formData(); }
  catch { throw new WorkspaceError(exceeded ? "Upload at most 20 MB per submission." : "Provide a multipart upload with testId, studentName, date and files.", exceeded ? 413 : 400); }
}
export async function payload(request: Request): Promise<Record<string, unknown>> {
  const body = await readRequestText(request, 1_000_000);
  try {
    const value = JSON.parse(body);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new WorkspaceError("Provide an object with the required fields.");
    return value;
  } catch (error) {
    if (error instanceof WorkspaceError) throw error;
    throw new WorkspaceError("Provide valid JSON.");
  }
}
const GUEST_COOKIE = "tutor_guest";
function guestToken(cookieHeader: string | null): string | null {
  const value = cookieHeader?.split(";").map(cookie => cookie.trim()).find(cookie => cookie.startsWith(`${GUEST_COOKIE}=`))?.slice(GUEST_COOKIE.length + 1);
  return value && /^[0-9a-f]{64}$/.test(value) ? value : null;
}
function hex(bytes: Uint8Array): string { return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join(""); }
async function guestUser(token: string): Promise<ChatGPTUser> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return { userId: `guest:${hex(new Uint8Array(digest))}`, displayName: "Guest", email: "", fullName: null };
}
export async function authenticated(action: (user: ChatGPTUser) => Promise<Response>, options: { allowGuestCreation?: boolean; requestUrl?: string } = {}): Promise<Response> {
  try {
    const user = await getChatGPTUser();
    if (user) return await action(user);
    const requestHeaders = await headers();
    let token = guestToken(requestHeaders.get("cookie")); let created = false;
    if (!token) {
      if (!options.allowGuestCreation) throw new WorkspaceError("Reload the workspace to start your guest session before saving records.", 401);
      token = hex(crypto.getRandomValues(new Uint8Array(32))); created = true;
    }
    const response = await action(await guestUser(token));
    if (created) {
      // Only the workspace GET can start a session. Credentials stay in an HttpOnly cookie.
      const secure = !options.requestUrl || new URL(options.requestUrl).protocol === "https:";
      response.headers.append("Set-Cookie", `${GUEST_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure ? "; Secure" : ""}`);
    }
    return response;
  } catch (error) {
    if (error instanceof WorkspaceError) return json({ error: error.message }, error.status);
    console.error("Workspace operation failed", error);
    return json({ error: "Workspace storage is unavailable. Check the D1/R2 bindings and database migrations, then try again." }, 503);
  }
}
export async function fileResponse(ownerId: string, fileId: string): Promise<Response> {
  const { object, metadata } = await getFile(ownerId, fileId);
  return new Response(object.body, { headers: { "Content-Type": metadata.mimeType, "Content-Length": String(metadata.size), "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(metadata.name)}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox" } });
}
