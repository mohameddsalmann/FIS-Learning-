const prefix = "fis2_study_draft:";

export function readStudyDraft(key: string): string | null {
  try { return sessionStorage.getItem(prefix + key); }
  catch { return null; }
}

export function writeStudyDraft(key: string, value: string) {
  try {
    if (value) sessionStorage.setItem(prefix + key, value);
    else sessionStorage.removeItem(prefix + key);
  } catch { /* The current page still keeps the draft. */ }
}

export function clearStudyDrafts() {
  try {
    for (let index = sessionStorage.length - 1; index >= 0; index--) {
      const key = sessionStorage.key(index);
      if (key?.startsWith(prefix)) sessionStorage.removeItem(key);
    }
  } catch { /* Drafts may be disabled in private browsing. */ }
}

export async function studyRequestKey(key: string, payload: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  const fingerprint = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
  const previous = readStudyDraft(key);
  if (previous?.startsWith(fingerprint + ":")) return previous.slice(fingerprint.length + 1);
  const id = crypto.randomUUID();
  writeStudyDraft(key, fingerprint + ":" + id);
  return id;
}
