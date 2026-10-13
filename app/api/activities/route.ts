import { createActivity } from "@/lib/store";
import { authenticated, json, payload } from "../_shared";
export const dynamic = "force-dynamic";
export async function POST(request: Request) { return authenticated(async user => { const state = await createActivity(user.userId, await payload(request)); return json({ state, activity: state.activities.at(-1) }, 201); }); }
