import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
const docs = new Set(["PRD","FR_NFR","ARCHITECTURE","DATABASE","API","AI_MODELS","RAG_PIPELINE","AI_EVALUATION","SECURITY","DEPLOYMENT","PORTFOLIO_CASE_STUDY","IMPLEMENTATION_STATUS"]);

export async function GET(_request: Request, { params }: { params: Promise<{ name:string }> }) {
  const {name} = await params;
  if (!docs.has(name)) return new Response("Document not found.",{status:404});
  try {
    const text = await readFile(path.join(process.cwd(),"docs",name+".md"),"utf8");
    return new Response(text,{headers:{"Content-Type":"text/plain; charset=utf-8","Cache-Control":"public, max-age=60"}});
  } catch { return new Response("Document unavailable.",{status:404}); }
}
