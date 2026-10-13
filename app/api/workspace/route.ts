import { generateBriefs, today, validateDate } from "@/lib/domain";
import { readWorkspace } from "@/lib/store";
import { authenticated, json } from "../_shared";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return authenticated(async user => {
    const queryDate = new URL(request.url).searchParams.get("date"); const date = queryDate ? validateDate(queryDate) : today();
    const state = await readWorkspace(user.userId);
    return json({ state, briefs: generateBriefs(state, date) });
  }, { allowGuestCreation: true, requestUrl: request.url });
}
