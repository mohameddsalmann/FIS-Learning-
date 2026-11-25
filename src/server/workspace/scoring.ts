type Question = {
  id: string;
  type: "MCQ" | "TRUE_FALSE" | "SHORT";
  answer: string;
  explanation: string;
  sourceIds: string[];
};

export function normalizeAnswer(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("en")
    .replace(/[\u0640\u064b-\u065f\u0670]/g, "")
    .trim().replace(/\s+/gu, " ").replace(/[.!؟?]+$/u, "");
}

export function assessAnswer(question: Question, submitted: string) {
  const exact = normalizeAnswer(submitted) === normalizeAnswer(question.answer);
  const reviewRequired = question.type === "SHORT" && !exact;
  const correct = reviewRequired ? null : exact;
  return {
    questionId: question.id,
    correct,
    reviewRequired,
    ideal: question.answer,
    explanation: question.explanation,
    sourceIds: question.sourceIds,
    correctConcepts: correct ? [question.answer] : [],
    missingConcepts: correct === false ? [question.answer] : [],
    incorrectStatements: correct === false ? [submitted] : [],
  };
}

export function revisionDue(score: number, total: number, now: Date) {
  if (!total) return null;
  const days = score / total < 0.7 ? 1 : 7;
  return new Date(now.getTime() + days * 86_400_000);
}
