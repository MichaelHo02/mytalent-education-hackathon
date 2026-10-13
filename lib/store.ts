import { env } from "cloudflare:workers";
import { approveMarking, draftMarking, emptyWorkspace, makeActivity, makeChatSubmission, makeFollowup, makeSavedBrief, makeSubmission, makeTest, WorkspaceError } from "./domain";
import type { CreateSubmissionInput, SubmissionFile, WorkspaceState } from "./types";
import { withOfficialReference } from "./reference-materials";

function ownerKey(ownerId: string): string {
  if (!ownerId || typeof ownerId !== "string" || ownerId.length > 256) throw new WorkspaceError("Sign in to access your workspace.", 401);
  return ownerId;
}
function database(): D1Database {
  if (!env.DB) throw new WorkspaceError("Workspace database is unavailable. Configure the Sites D1 binding and apply migrations.", 503);
  return env.DB;
}
type WorkspaceRow = { payload: string; version: number };
async function readRow(ownerId: string): Promise<WorkspaceRow | null> {
  return database().prepare("SELECT payload, version FROM workspace_states WHERE owner_id = ?").bind(ownerKey(ownerId)).first<WorkspaceRow>();
}
export async function readWorkspace(ownerId: string): Promise<WorkspaceState> {
  const row = await readRow(ownerId); return withOfficialReference(row ? JSON.parse(row.payload) as WorkspaceState : emptyWorkspace());
}
/** Updater must be synchronous and free of side effects: a conflicting write is retried. */
export async function mutateWorkspace(ownerId: string, updater: (state: WorkspaceState) => WorkspaceState): Promise<WorkspaceState> {
  const key = ownerKey(ownerId);
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await readRow(key); const state = withOfficialReference(row ? JSON.parse(row.payload) as WorkspaceState : emptyWorkspace());
    const next = updater(state); const payload = JSON.stringify(next);
    // Leave room for the owner key and other fields within D1's 2 MB row limit.
    if (new TextEncoder().encode(payload).byteLength > 1_800_000) throw new WorkspaceError("This prototype workspace has reached its record limit. Export existing records; additional capacity needs a database upgrade.", 413);
    const result = row
      ? await database().prepare("UPDATE workspace_states SET payload = ?, version = version + 1, updated_at = ? WHERE owner_id = ? AND version = ?").bind(payload, new Date().toISOString(), key, row.version).run()
      : await database().prepare("INSERT INTO workspace_states (owner_id, payload, version, updated_at) VALUES (?, ?, 0, ?) ON CONFLICT(owner_id) DO NOTHING").bind(key, payload, new Date().toISOString()).run();
    if (result.meta.changes === 1) return next;
  }
  throw new WorkspaceError("The workspace is being edited in another window. Reload and try again.", 409);
}
export async function createTest(ownerId: string, input: unknown): Promise<WorkspaceState> {
  const test = makeTest(input, crypto.randomUUID(), new Date().toISOString());
  return mutateWorkspace(ownerId, state => ({ ...state, tests: [...state.tests, test] }));
}
export async function createSubmission(ownerId: string, input: CreateSubmissionInput): Promise<WorkspaceState> {
  const id = crypto.randomUUID(); const createdAt = new Date().toISOString();
  return mutateWorkspace(ownerId, state => ({ ...state, submissions: [...state.submissions, makeSubmission(state, input, id, createdAt)] }));
}
export async function createChatSubmission(ownerId: string, input: unknown): Promise<WorkspaceState> {
  const id = crypto.randomUUID(); const createdAt = new Date().toISOString();
  return mutateWorkspace(ownerId, state => ({ ...state, submissions: [...state.submissions, makeChatSubmission(state, input, id, createdAt)] }));
}
export async function saveDraftMarking(ownerId: string, submissionId: string, questions: unknown, expectedRevision: unknown): Promise<WorkspaceState> {
  return mutateWorkspace(ownerId, state => draftMarking(state, submissionId, questions, expectedRevision));
}
export async function approveSubmission(ownerId: string, submissionId: string, expectedRevision: unknown): Promise<WorkspaceState> {
  const approvedAt = new Date().toISOString();
  return mutateWorkspace(ownerId, state => approveMarking(state, submissionId, expectedRevision, approvedAt));
}
export async function createActivity(ownerId: string, input: unknown): Promise<WorkspaceState> {
  const activity = makeActivity(input, crypto.randomUUID());
  return mutateWorkspace(ownerId, state => ({ ...state, activities: [...state.activities, activity] }));
}
export async function createFollowup(ownerId: string, input: unknown): Promise<WorkspaceState> {
  const followup = makeFollowup(input, crypto.randomUUID());
  return mutateWorkspace(ownerId, state => ({ ...state, followups: [...state.followups, followup] }));
}
export async function updateFollowup(ownerId: string, id: string, done: unknown): Promise<WorkspaceState> {
  if (typeof done !== "boolean") throw new WorkspaceError("done must be true or false.");
  return mutateWorkspace(ownerId, state => {
    if (!state.followups.some(f => f.id === id)) throw new WorkspaceError("Follow-up not found.", 404);
    return { ...state, followups: state.followups.map(f => f.id === id ? { ...f, done } : f) };
  });
}
export async function saveConversationBrief(ownerId: string, input: unknown): Promise<WorkspaceState> {
  const id = crypto.randomUUID(); const createdAt = new Date().toISOString();
  return mutateWorkspace(ownerId, state => ({ ...state, briefs: [...state.briefs ?? [], makeSavedBrief(state, input, id, createdAt)] }));
}
function bucket(): R2Bucket {
  if (!env.BUCKET) throw new WorkspaceError("File storage is unavailable. Configure the Sites R2 binding.", 503);
  return env.BUCKET;
}
const MAX_FILE_BYTES = 20 * 1024 * 1024;
export function validateFile(file: File): void {
  if (file.size <= 0 || file.size > MAX_FILE_BYTES) throw new WorkspaceError("Each file must contain data and be at most 20 MB.", 413);
  if (!["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new WorkspaceError("Upload PDF, JPEG, PNG or WebP files only.");
  if (!file.name || file.name.length > 240) throw new WorkspaceError("File names must have between 1 and 240 characters.");
}
function fileKey(ownerId: string, fileId: string): string {
  if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(fileId)) throw new WorkspaceError("File not found.", 404);
  return `owners/${encodeURIComponent(ownerKey(ownerId))}/files/${fileId}`;
}
export async function uploadFile(ownerId: string, file: File): Promise<SubmissionFile> {
  validateFile(file); const bytes = await file.arrayBuffer(); const header = new Uint8Array(bytes.slice(0, 12));
  const signatureMatches = file.type === "application/pdf" ? new TextDecoder().decode(header.slice(0, 5)) === "%PDF-"
    : file.type === "image/jpeg" ? header[0] === 255 && header[1] === 216 && header[2] === 255
    : file.type === "image/png" ? [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => header[index] === byte)
    : new TextDecoder().decode(header.slice(0, 4)) === "RIFF" && new TextDecoder().decode(header.slice(8, 12)) === "WEBP";
  if (!signatureMatches) throw new WorkspaceError(`The content of ${file.name} does not match its file type.`);
  const metadata: SubmissionFile = { id: crypto.randomUUID(), name: file.name.replace(/[\x00-\x1f\x7f]/g, "").replace(/[/\\]/g, "_"), mimeType: file.type, size: file.size };
  await bucket().put(fileKey(ownerId, metadata.id), bytes, { httpMetadata: { contentType: file.type } });
  return metadata;
}
export async function removeUploadedFile(ownerId: string, id: string): Promise<void> { await bucket().delete(fileKey(ownerId, id)); }
export async function getFile(ownerId: string, id: string): Promise<{ object: R2ObjectBody; metadata: SubmissionFile }> {
  const state = await readWorkspace(ownerId); const metadata = state.submissions.flatMap(s => s.files).find(f => f.id === id);
  if (!metadata) throw new WorkspaceError("File not found.", 404);
  const stored = await bucket().get(fileKey(ownerId, id));
  if (!stored) throw new WorkspaceError("File not found in storage.", 404);
  return { object: stored, metadata };
}
