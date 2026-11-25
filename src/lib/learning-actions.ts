const storageKey = "fis2_learning_actions";
export type LearningAction = "suggestion" | "sample-quiz" | "progress";

export function hasLearningAction(action: LearningAction) {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
    return Array.isArray(stored) && stored.includes(action);
  } catch { return false; }
}

export function markLearningAction(action: LearningAction) {
  if (hasLearningAction(action)) return;
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
    localStorage.setItem(storageKey, JSON.stringify([...(Array.isArray(stored) ? stored : []), action]));
  } catch { /* Checklist storage is optional. */ }
}
