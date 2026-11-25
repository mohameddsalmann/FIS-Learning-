import { gateway } from "@/server/ai/gateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await gateway.catalog(), { headers: { "Cache-Control": "no-store" } });
}
