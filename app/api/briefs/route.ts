import { saveConversationBrief } from "@/lib/store";
import { authenticated, json, payload } from "../_shared";
export const dynamic = "force-dynamic";
export async function POST(request: Request) { return authenticated(async user => { const state = await saveConversationBrief(user.userId, await payload(request)); return json({ state, brief: state.briefs?.at(-1) }, 201); }); }
