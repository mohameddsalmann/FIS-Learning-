import { StudyChat } from "@/components/study/StudyChat";
import { StudyTools } from "@/components/study/StudyTools";

export const metadata = { title: "Study tutor" };

export default async function ChatPage({ searchParams }: { searchParams: Promise<{ course?: string; conversation?: string; prompt?: string }> }) {
  const query = await searchParams;
  const courseId = typeof query.course === "string" ? query.course.slice(0, 80) : undefined;
  const conversationId = typeof query.conversation === "string" ? query.conversation.slice(0, 80) : undefined;
  const initialPrompt = typeof query.prompt === "string" ? query.prompt.slice(0, 1000) : undefined;
  return <div className="page-width content-page stack tight">
    <div className="card"><StudyChat key={conversationId ?? courseId ?? "standalone"} courseId={courseId} conversationId={conversationId} initialPrompt={initialPrompt} heading="h1" /></div>
    <StudyTools />
  </div>;
}
