import { handle } from "@/lib/server/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET(request: Request, context: { params: Promise<Record<string, string>> }) { return handle(request, await context.params, "health"); }
