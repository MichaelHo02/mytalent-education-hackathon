import { makeSubmission, WorkspaceError } from "@/lib/domain";
import { createSubmission, readWorkspace, removeUploadedFile, uploadFile, validateFile } from "@/lib/store";
import type { SubmissionFile } from "@/lib/types";
import { authenticated, json, multipartPayload } from "../_shared";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  return authenticated(async user => {
    const form = await multipartPayload(request, 22 * 1024 * 1024);
    const files = form.getAll("files").filter((value): value is File => value instanceof File);
    if (!files.length || files.length > 20 || files.length !== form.getAll("files").length) throw new WorkspaceError("Upload between 1 and 20 pages or PDFs.");
    if (files.reduce((total, file) => total + file.size, 0) > 20 * 1024 * 1024) throw new WorkspaceError("Upload at most 20 MB per submission.", 413);
    files.forEach(validateFile);
    const testId = form.get("testId"); const studentName = form.get("studentName"); const date = form.get("date");
    if (typeof testId !== "string" || typeof studentName !== "string" || typeof date !== "string") throw new WorkspaceError("Provide testId, studentName and date.");
    const state = await readWorkspace(user.userId);
    // Validate the record before storing any files; roll back stored pages if saving fails.
    makeSubmission(state, { testId, studentName, date, files: files.map(file => ({ id: "pending", name: file.name, mimeType: file.type, size: file.size })) }, "pending", new Date().toISOString());
    const uploaded: SubmissionFile[] = [];
    try {
      for (const file of files) uploaded.push(await uploadFile(user.userId, file));
      const updated = await createSubmission(user.userId, { testId, studentName, date, files: uploaded });
      return json({ state: updated, submission: updated.submissions.at(-1) }, 201);
    } catch (error) {
      await Promise.allSettled(uploaded.map(file => removeUploadedFile(user.userId, file.id)));
      throw error;
    }
  });
}
