import { authenticated, fileResponse } from "../../_shared";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) { return authenticated(async user => fileResponse(user.userId, (await context.params).id)); }
