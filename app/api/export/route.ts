import { exportWorkspaceCsv, today, validateDate, WorkspaceError } from "@/lib/domain";
import { readWorkspace } from "@/lib/store";
import type { ExportKind } from "@/lib/types";
import { authenticated } from "../_shared";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return authenticated(async user => {
    const query = new URL(request.url).searchParams; const kind = query.get("kind") as ExportKind;
    if (!["marking", "progress", "exams", "daily"].includes(kind)) throw new WorkspaceError("Select marking, progress, exams or daily as the export kind.");
    const date = query.get("date") ? validateDate(query.get("date")) : today();
    return new Response(exportWorkspaceCsv(await readWorkspace(user.userId), kind, date), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="tutor-${kind}-${date}.csv"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  });
}
