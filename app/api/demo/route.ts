import { seedDemo } from "@/lib/store";
import { authenticated, json } from "../_shared";
export const dynamic = "force-dynamic";
export async function POST() { return authenticated(async user => json({ state: await seedDemo(user.userId) }, 201)); }
