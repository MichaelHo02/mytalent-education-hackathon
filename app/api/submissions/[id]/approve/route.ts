import { approveSubmission } from "@/lib/store";
import { authenticated, json, payload } from "../../../_shared";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return authenticated(async user => { const body = await payload(request); const { id } = await context.params; const state = await approveSubmission(user.userId, id, body.expectedRevision); return json({ state, submission: state.submissions.find(s => s.id === id) }); });
}
