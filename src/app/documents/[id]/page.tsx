import { DocumentViewer } from "@/components/study/DocumentViewer";

export const metadata = { title: "Source viewer", robots: { index: false } };

export default async function SourcePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ page?: string; citation?: string }> }) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const value = typeof query.page === "string" ? Number(query.page) : 1;
  const initialPage = Number.isSafeInteger(value) && value > 0 ? value : 1;
  const citationId = typeof query.citation === "string" ? query.citation.slice(0, 120) : undefined;
  return <div className="page-width content-page tight"><div className="card"><DocumentViewer key={id + ":" + initialPage + ":" + (citationId ?? "")} documentId={id} initialPage={initialPage} citationId={citationId} /></div></div>;
}
