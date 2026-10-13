import { createTest } from "@/lib/store";
import { authenticated, json, payload } from "../_shared";
export const dynamic = "force-dynamic";
export async function POST(request: Request) { return authenticated(async user => { const state = await createTest(user.userId, await payload(request)); return json({ state, test: state.tests.at(-1) }, 201); }); }
