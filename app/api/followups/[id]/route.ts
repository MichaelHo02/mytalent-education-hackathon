import { updateFollowup } from "@/lib/store";
import { authenticated, json, payload } from "../../_shared";
export const dynamic = "force-dynamic";
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) { return authenticated(async user => { const body = await payload(request); const { id } = await context.params; return json({ state: await updateFollowup(user.userId, id, body.done) }); }); }
