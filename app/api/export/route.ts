import { exportWorkspaceCsv, today, validateDate, WorkspaceError } from "@/lib/domain";
import { readWorkspace } from "@/lib/store";
import { exportExhibitsWorkbook, exportFeedbackHtml } from "@/lib/report-exports";
import type { ExportKind } from "@/lib/types";
import { authenticated } from "../_shared";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return authenticated(async user => {
    const query = new URL(request.url).searchParams; const kind = query.get("kind") ?? "";
    const submissionId = query.get("submissionId") ?? "";
    const date = query.get("date") ? validateDate(query.get("date")) : today();
    const state = await readWorkspace(user.userId);
    const privateHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
    if (kind === "exhibits") return new Response(await exportExhibitsWorkbook(state, submissionId), { headers: { ...privateHeaders, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="mytalent-exhibits-${date}.xlsx"` } });
    if (kind === "feedback") return new Response(exportFeedbackHtml(state, submissionId, query.has("date") ? date : undefined), { headers: { ...privateHeaders, "Content-Type": "text/html; charset=utf-8", "Content-Disposition": `attachment; filename="mytalent-feedback-${date}.html"`, "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox" } });
    if (!["marking", "progress", "exams", "daily"].includes(kind)) throw new WorkspaceError("Select exhibits, feedback, marking, progress, exams or daily as the export kind.");
    return new Response(exportWorkspaceCsv(state, kind as ExportKind, date), { headers: { ...privateHeaders, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="tutor-${kind}-${date}.csv"` } });
  });
}
