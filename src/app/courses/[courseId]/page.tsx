import { CourseWorkspace } from "@/components/course-workspace";
import { getLanguage } from "@/lib/server-locale";

export default async function CoursePage({ params, searchParams }: {
  params: Promise<{ courseId: string }>; searchParams: Promise<{ document?: string }>;
}) {
  const [route, query, lang] = await Promise.all([params,searchParams,getLanguage()]);
  const activeDocumentId = typeof query.document === "string" ? query.document.slice(0, 128) : undefined;
  return <CourseWorkspace key={route.courseId} courseId={route.courseId} lang={lang} activeDocumentId={activeDocumentId} />;
}
