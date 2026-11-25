import { Practice } from "@/components/practice";
import { getLanguage } from "@/lib/server-locale";

export default async function PracticePage({ searchParams }: { searchParams: Promise<{ course?: string; topic?: string; sample?: string; attempt?: string; quiz?: string }> }) {
  const [lang, query] = await Promise.all([getLanguage(),searchParams]);
  const courseId = typeof query.course === "string" ? query.course.slice(0, 100) : undefined;
  const attemptId = typeof query.attempt === "string" ? query.attempt.slice(0, 100) : undefined;
  const quizId = typeof query.quiz === "string" ? query.quiz.slice(0, 100) : undefined;
  return <Practice key={attemptId ?? quizId ?? (query.sample === "1" ? "sample" : courseId ?? "new")} lang={lang} courseId={courseId}
    topicId={typeof query.topic === "string" ? query.topic.slice(0, 100) : undefined} attemptId={attemptId} quizId={quizId} sample={query.sample === "1"} />;
}
