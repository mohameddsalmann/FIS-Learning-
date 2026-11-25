import { database } from "../db/client";
import { Prisma } from "../db/generated/client";
import { WorkspaceError } from "../workspace/errors";
import { CHUNK_STRATEGY, LEGACY_CHUNK_STRATEGY, LEGACY_PROCESSING_VERSION, PROCESSING_VERSION, serializeVector } from "./chunks";

export interface CourseSource {
  id: string;
  documentId: string;
  page: number;
  text: string;
  title: string;
}

type RankedSource = CourseSource & { contentHash: string; ordinal: number; processingVersion: number; chunkStrategy: string };
type Embed = (inputs: string[], model?: string) => Promise<{ model: string; vectors: number[][] }>;
type Rerank = (query: string, candidates: string[]) => Promise<number[]>;
const ORACLE_LIMIT = 18;
export const SOURCE_LIMIT = 6;
const CONTEXT_TOKEN_BUDGET = 2400;
const stopWords = new Set(`a an the and or of in on about to for is are was were do does did what which why how when where who me can you please explain describe show tell give compare difference between with from as using example question summarize start page pages cite supporting pdf في من على علي إلى الى الي عن مع ما ماذا هل كيف متى متي لماذا اين أي اي اشرح وضح لي كيفيه كيفية الفرق بين يعني عرف قارن مثال يكون يمكن هذا هذه و او أو ال لخص ابدا الصفحة الصفحات واستشهد الداعمة`.split(" "));
const ownerScope = (ownerId: string, courseId: string) => Prisma.sql`
  p."id" = ${courseId} AND p."ownerId" = ${ownerId} AND p."deletionPending" = false AND d."status" = 'READY'
  AND ((c."processingVersion" = ${PROCESSING_VERSION} AND c."chunkStrategy" = ${CHUNK_STRATEGY})
    OR (c."processingVersion" = ${LEGACY_PROCESSING_VERSION} AND c."chunkStrategy" = ${LEGACY_CHUNK_STRATEGY}))
`;

function uniqueDocument(matchesEmbeddingSpace = false) {
  const compatible = matchesEmbeddingSpace ? Prisma.sql`
    AND EXISTS (
      SELECT 1 FROM "DocumentChunk" previous_chunk
      WHERE previous_chunk."documentId" = previous."id" AND previous_chunk."ordinal" = c."ordinal"
        AND previous_chunk."processingVersion" = c."processingVersion" AND previous_chunk."chunkStrategy" = c."chunkStrategy"
        AND previous_chunk."embedding" IS NOT NULL AND previous_chunk."embeddingModel" = c."embeddingModel"
        AND previous_chunk."embeddingDimension" = c."embeddingDimension"
    )
  ` : Prisma.empty;
  return Prisma.sql`NOT EXISTS (
    SELECT 1 FROM "Document" previous
    WHERE previous."courseId" = d."courseId" AND previous."status" = 'READY'
      AND previous."learningOutline"->>'contentFingerprint' = d."learningOutline"->>'contentFingerprint'
      AND (previous."createdAt", previous."id") < (d."createdAt", d."id")
      ${compatible}
  )`;
}

function normalizeTerm(term: string) {
  return term.normalize("NFKC").toLowerCase().replace(/[\u0640\u064B-\u065F\u0670]/gu, "")
    .replace(/[أإآٱ]/gu, "ا").replace(/ى/gu, "ي");
}

export function retrievalTerms(query: string, limit = 12) {
  const words = query.normalize("NFKC").toLowerCase().replace(/(?<=\p{Script=Latin})['’]s\b/gu, "")
    .match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]*/gu) ?? [];
  return [...new Set(words.filter((word) => !stopWords.has(normalizeTerm(word))))].slice(0, limit);
}

function lexicalQuery(terms: string[]) {
  const variants = new Set<string>();
  for (const term of terms) {
    const add = (word: string) => {
      if (word.length >= 2) variants.add(word.length >= 5 ? `${word}:*` : word);
    };
    add(term);
    const normalized = normalizeTerm(term);
    add(normalized);
    if (/^ال\p{Script=Arabic}{3,}$/u.test(normalized)) add(normalized.slice(2));
    if (/^\p{Script=Arabic}{3,}$/u.test(normalized) && !normalized.startsWith("ال")) add(`ال${normalized}`);
    if (/^[a-z]{4,}(?:s|ed|ing)$/u.test(normalized)) add(normalized.replace(/(?:es|s|ed|ing)$/u, ""));
  }
  return [...variants].join(" | ");
}

function comparableTerm(term: string) {
  return normalizeTerm(term).replace(/^ال(?=\p{Script=Arabic}{3,}$)/u, "").replace(/(?<=[a-z]{4})(?:es|s|ed|ing)$/u, "");
}

function hasLexicalSupport(terms: string[], sources: RankedSource[]) {
  const distinct = new Set(terms.map(comparableTerm).filter((term) => term.length >= 2));
  if (distinct.size < 5) return sources.length > 0;
  const found = new Set(sources.slice(0, 3).flatMap(({ text }) => retrievalTerms(text, Infinity).map(comparableTerm)));
  return [...distinct].filter((term) => found.has(term)).length >= Math.ceil(distinct.size * 0.4);
}

function estimatedTokens(text: string) {
  const arabic = text.match(/\p{Script=Arabic}/gu)?.length ?? 0;
  return Math.ceil((text.length - arabic) / 4 + arabic / 1.7) + 20;
}

function boundedContext(sources: RankedSource[], limit = SOURCE_LIMIT): CourseSource[] {
  let remaining = CONTEXT_TOKEN_BUDGET;
  const context: CourseSource[] = [];
  for (const { id, documentId, page, text, title } of uniqueContent(sources)) {
    const cost = estimatedTokens(text) + estimatedTokens(title);
    if (cost > remaining) continue;
    context.push({ id, documentId, page, text, title });
    remaining -= cost;
    if (context.length === limit) break;
  }
  return context;
}

export async function assertOwnedCourse(ownerId: string, courseId: string) {
  const course = await database().course.findFirst({ where: { id: courseId, ownerId, deletionPending: false } });
  if (!course) throw new WorkspaceError(404, "That course is unavailable.");
  return course;
}

export function reciprocalRank<T extends { id: string }>(rankings: T[][], constant = 60) {
  const totals = new Map<string, { source: T; score: number }>();
  for (const list of rankings) {
    const seen = new Set<string>();
    list.forEach((source, index) => {
      if (seen.has(source.id)) return;
      seen.add(source.id);
      const previous = totals.get(source.id);
      totals.set(source.id, { source, score: (previous?.score ?? 0) + 1 / (constant + index + 1) });
    });
  }
  return [...totals.values()].sort((a, b) => b.score - a.score || a.source.id.localeCompare(b.source.id))
    .map(({ source }) => source);
}

function uniqueContent(sources: RankedSource[]) {
  const hashes = new Set<string>();
  return sources.filter(({ contentHash }) => {
    if (hashes.has(contentHash)) return false;
    hashes.add(contentHash);
    return true;
  });
}

export async function getCourseSources(ownerId: string, courseId: string): Promise<CourseSource[]> {
  await assertOwnedCourse(ownerId, courseId);
  const sources = await database().$queryRaw<RankedSource[]>`
    SELECT c."id", c."documentId", c."page", c."text", c."contentHash", c."ordinal", c."processingVersion", c."chunkStrategy", d."title"
    FROM "DocumentChunk" c
    JOIN "Document" d ON d."id" = c."documentId"
    JOIN "Course" p ON p."id" = d."courseId"
    WHERE ${ownerScope(ownerId, courseId)} AND ${uniqueDocument()}
    ORDER BY c."ordinal", d."createdAt", c."id"
    LIMIT 16
  `;
  return boundedContext(sources, 16);
}

export async function retrieveCourseSources(
  ownerId: string, courseId: string, query: string, embed: Embed,
  options: { mode?: "vector" | "hybrid"; expandNeighbors?: boolean; evaluationRerank?: Rerank } = {},
): Promise<CourseSource[]> {
  await assertOwnedCourse(ownerId, courseId);
  const db = database();
  const scope = ownerScope(ownerId, courseId);
  const columns = Prisma.sql`c."id", c."documentId", c."page", c."text", c."contentHash", c."ordinal", c."processingVersion", c."chunkStrategy", d."title"`;
  const terms = retrievalTerms(query);
  const words = options.mode !== "vector" ? lexicalQuery(terms) : "";
  const [keyword, spaces] = await Promise.all([
    words ? db.$queryRaw<RankedSource[]>`
      SELECT ${columns}
      FROM "DocumentChunk" c
      JOIN "Document" d ON d."id" = c."documentId"
      JOIN "Course" p ON p."id" = d."courseId"
      CROSS JOIN to_tsquery('simple', ${words}) AS words(query)
      WHERE ${scope} AND c."searchVector" @@ words.query AND ${uniqueDocument()}
      ORDER BY ts_rank_cd(c."searchVector", words.query) DESC, c."id"
      LIMIT ${ORACLE_LIMIT}
    ` : [],
    db.$queryRaw<{ model: string; dimension: number }[]>`
      SELECT c."embeddingModel" AS model, c."embeddingDimension" AS dimension
      FROM "DocumentChunk" c
      JOIN "Document" d ON d."id" = c."documentId"
      JOIN "Course" p ON p."id" = d."courseId"
      WHERE ${scope} AND c."embedding" IS NOT NULL AND c."embeddingModel" IS NOT NULL
        AND c."embeddingDimension" IS NOT NULL AND ${uniqueDocument(true)}
      GROUP BY c."embeddingModel", c."embeddingDimension"
      ORDER BY count(*) DESC, c."embeddingModel" ASC, c."embeddingDimension" ASC LIMIT 1
    `,
  ]);
  let semantic: RankedSource[] = [];
  const space = spaces[0];
  if (space) {
    try {
      const indexed = await embed([query], space.model);
      const vector = indexed.vectors[0];
      if (indexed.model !== space.model || vector?.length !== space.dimension) {
        throw new WorkspaceError(503, "The course index uses a different embedding version. Reprocess the source material.");
      }
      const value = serializeVector(vector);
      const distance = space.dimension === 2048
        ? Prisma.sql`c."embedding"::halfvec(2048) <=> ${value}::halfvec(2048)`
        : Prisma.sql`c."embedding" <=> ${value}::vector`;
      semantic = await db.$queryRaw<RankedSource[]>`
        SELECT ${columns}
        FROM "DocumentChunk" c
        JOIN "Document" d ON d."id" = c."documentId"
        JOIN "Course" p ON p."id" = d."courseId"
        WHERE ${scope} AND c."embeddingModel" = ${space.model} AND c."embeddingDimension" = ${space.dimension}
          AND c."embedding" IS NOT NULL AND (${distance}) <= 0.72 AND ${uniqueDocument(true)}
        ORDER BY (${distance}) ASC
        LIMIT ${ORACLE_LIMIT}
      `;
    } catch (error) {
      if (!keyword.length) throw error;
    }
  }
  const lexical = semantic.length || hasLexicalSupport(terms, keyword) ? keyword : [];
  let candidates = uniqueContent(reciprocalRank([semantic, lexical])).slice(0, 10);
  if (options.evaluationRerank && semantic.length && lexical.length && candidates.length >= 6 && semantic[0]?.id !== lexical[0]?.id) {
    try {
      const indices = await options.evaluationRerank(query, candidates.map(({ text }) => text));
      if (indices.length && new Set(indices).size === indices.length && indices.every((index) => Number.isInteger(index) && candidates[index])) {
        const visited = new Set(indices);
        candidates = [...indices.map((index) => candidates[index]), ...candidates.filter((_, index) => !visited.has(index))];
      }
    } catch {
      // Reranking is an optional improvement. The fused sources remain usable.
    }
  }
  const anchor = candidates[0];
  if (anchor && anchor.processingVersion === PROCESSING_VERSION && options.expandNeighbors !== false && options.mode !== "vector") {
    const neighbors = await db.$queryRaw<RankedSource[]>`
      SELECT ${columns}
      FROM "DocumentChunk" c
      JOIN "Document" d ON d."id" = c."documentId"
      JOIN "Course" p ON p."id" = d."courseId"
      WHERE ${scope} AND c."documentId" = ${anchor.documentId}
        AND c."processingVersion" = ${anchor.processingVersion} AND c."chunkStrategy" = ${anchor.chunkStrategy}
        AND c."ordinal" IN (${anchor.ordinal - 1}, ${anchor.ordinal + 1})
        AND c."page" BETWEEN ${anchor.page - 1} AND ${anchor.page + 1}
      ORDER BY c."ordinal"
    `;
    const candidateIds = new Set(candidates.slice(0, SOURCE_LIMIT).map(({ id }) => id));
    const neighbor = neighbors.find((source) => {
      if (candidateIds.has(source.id)) return false;
      if (source.page === anchor.page) return true;
      const sourceTerms = new Set(retrievalTerms(source.text, Infinity).map(normalizeTerm));
      return terms.some((term) => sourceTerms.has(normalizeTerm(term)));
    });
    if (neighbor) candidates.splice(SOURCE_LIMIT - 1, 0, neighbor);
  }
  return boundedContext(candidates);
}
