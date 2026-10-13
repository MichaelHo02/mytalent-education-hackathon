import { WorkspaceError } from "@/lib/domain";
import { authenticated, fileResponse } from "../_shared";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return authenticated(async user => { const id = new URL(request.url).searchParams.get("id"); if (!id) throw new WorkspaceError("Provide the file ID."); return fileResponse(user.userId, id); }); }
