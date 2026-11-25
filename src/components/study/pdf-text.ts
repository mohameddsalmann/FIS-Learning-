export interface TextRun {
  str: string;
}

export function normalizePdfText(value: string) {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLocaleLowerCase();
}

export function pdfMatches(runs: TextRun[], query: string): number[] {
  const needle = normalizePdfText(query);
  if (!needle) return [];
  let text = "";
  const offsets = runs.map(({ str }) => {
    if (text) text += " ";
    const begin = text.length;
    text += normalizePdfText(str);
    return { begin, end: text.length };
  });
  const positions: number[] = [];
  for (let pointer = text.indexOf(needle); pointer >= 0; pointer = text.indexOf(needle, pointer + needle.length)) {
    positions.push(pointer);
  }
  return offsets.flatMap(({ begin, end }, index) => positions.some((start) => begin < start + needle.length && end > start) ? [index] : []);
}
