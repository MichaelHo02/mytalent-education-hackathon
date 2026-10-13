import { saveDraftMarking } from "@/lib/store";
import { WorkspaceError } from "@/lib/domain";
import { authenticated, json, payload } from "../../_shared";
export const dynamic = "force-dynamic";
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return authenticated(async user => {
    const body = await payload(request); const { id } = await context.params;
    if ("status" in body || "approvedAt" in body) throw new WorkspaceError("Use the tutor approval action to approve marking.");
    const state = await saveDraftMarking(user.userId, id, body.questions, body.expectedRevision);
    return json({ state, submission: state.submissions.find(s => s.id === id) });
  });
}
