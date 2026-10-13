import { createFollowup } from "@/lib/store";
import { authenticated, json, payload } from "../_shared";
export const dynamic = "force-dynamic";
export async function POST(request: Request) { return authenticated(async user => { const state = await createFollowup(user.userId, await payload(request)); return json({ state, followup: state.followups.at(-1) }, 201); }); }
