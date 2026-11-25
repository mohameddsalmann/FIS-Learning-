import { getAuth } from "@/server/auth/config";
import { apiError } from "@/server/workspace/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handler(request: Request) {
  try {
    return await getAuth().handler(request);
  } catch (error) {
    return apiError(error);
  }
}

export { handler as GET, handler as POST };
