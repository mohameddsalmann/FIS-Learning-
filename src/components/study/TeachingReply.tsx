"use client";

import Link from "next/link";
import { useId, useState, type ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { mermaidGraph, splitTeachingAnswer, type TeachingBlock, type TeachingGraph, type TeachingGrounding } from "@/lib/teaching-content";
import { sourceHref, type SourceCitation, type StudyLanguage } from "./client";
import styles from "./teaching.module.css";

type VisualBlock = Extract<TeachingBlock, { grounding: TeachingGrounding }>;
type SourceOpen = (source: SourceCitation) => void;
type Illustration = Extract<TeachingBlock, { type: "illustration" }>;
const mathOptions = { trust: false, maxExpand: 200, maxSize: 12 };

export function CitationLink({ source, onSourceOpen, className, children }: {
  source: SourceCitation; onSourceOpen?: SourceOpen; className?: string; children: ReactNode;
}) {
  return <Link className={className} href={sourceHref(source)} onClick={(event) => {
    if (onSourceOpen && !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey) {
      event.preventDefault();
      onSourceOpen(source);
    }
  }}>{children}</Link>;
}

function replyMarkdown(sources: Map<string, SourceCitation>, onSourceOpen?: SourceOpen) {
  function inline(children: ReactNode): ReactNode {
    if (Array.isArray(children)) return children.map(inline);
    if (typeof children !== "string") return children;
    const fragments = children.split(/(\[S\d+\])/g);
    if (fragments.length === 1) return children;
    return fragments.map((fragment, index) => {
      const source = index % 2 ? sources.get(fragment.slice(1, -1)) : undefined;
      return source ? <CitationLink key={index} source={source} onSourceOpen={onSourceOpen}>{fragment}</CitationLink> : index % 2 ? "" : fragment;
    });
  }
  const components: Components = {
    p: ({ children }) => <p>{inline(children)}</p>,
    li: ({ children }) => <li>{inline(children)}</li>,
    strong: ({ children }) => <strong>{inline(children)}</strong>,
    em: ({ children }) => <em>{inline(children)}</em>,
    h1: ({ children }) => <h3>{inline(children)}</h3>,
    h2: ({ children }) => <h3>{inline(children)}</h3>,
    h3: ({ children }) => <h3>{inline(children)}</h3>,
    h4: ({ children }) => <h4>{inline(children)}</h4>,
  };
  return function renderMarkdown(content: string) {
    return <Markdown skipHtml disallowedElements={["img"]} components={components}
      remarkPlugins={[remarkMath]} rehypePlugins={[[rehypeKatex, mathOptions]]}>{content}</Markdown>;
  };
}

function FlowDiagram({ graph, ar }: { graph: TeachingGraph; ar: boolean }) {
  const marker = useId();
  const centers = new Map(graph.nodes.map((node, index) => [node.id, 26 + index * 68]));
  const label = new Map(graph.nodes.map((node) => [node.id, node.label]));
  return <>
    <svg className={styles.diagram} aria-hidden="true" viewBox={`0 0 500 ${graph.nodes.length * 68 - 16}`}>
      <defs><marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
        <path d="M0 0 L10 5 L0 10 z" fill="currentColor" />
      </marker></defs>
      {graph.edges.map(({ from, to }, index) => {
        const start = centers.get(from)!;
        const end = centers.get(to)!;
        const drifts = index % 4;
        const lane = 20 + drifts * 11;
        const path = end - start === 68 ? `M250 ${start + 20} V${end - 22}`
          : `M80 ${start} H${lane} V${end} H77`;
        return <path key={from + ">" + to} d={path} markerEnd={"url(#" + marker + ")"} fill="none" stroke="currentColor" strokeWidth="2" />;
      })}
      {graph.nodes.map(({ id, label }) => <g key={id}>
        <rect x="80" y={centers.get(id)! - 20} width="340" height="40" rx="8" />
        <foreignObject x="85" y={centers.get(id)! - 20} width="330" height="40">
          <span className={styles.diagramLabel} dir="auto">{label}</span>
        </foreignObject>
      </g>)}
    </svg>
    <details><summary>{ar ? "العلاقات نصّياً" : "Relationships as text"}</summary>
      <ul>{graph.edges.map(({ from, to }) => <li dir="auto" key={from + ">" + to}>{label.get(from)} → {label.get(to)}</li>)}</ul>
    </details>
  </>;
}

function DataChart({ block, language }: { block: Extract<TeachingBlock, { type: "chart" }>; language: StudyLanguage }) {
  const [active, setActive] = useState(0);
  const signed = block.values.some(({ value }) => value < 0);
  const scale = Math.max(...block.values.map(({ value }) => Math.abs(value))) || 1;
  const number = new Intl.NumberFormat(language, { maximumSignificantDigits: 10 });
  const format = (value: number) => [number.format(value), block.unit].filter(Boolean).join(" ");
  return <>
    <ul className={styles.chart} aria-label={language === "ar" ? "قيم الرسم البياني" : "Chart values"}>
      {block.values.map(({ label, value }, index) => {
        const width = Math.abs(value) / scale * (signed ? 50 : 100);
        return <li key={label}><button type="button" aria-pressed={active === index} className={styles.dataPoint} onClick={() => setActive(index)}>
          <span dir="auto">{label}</span><span dir="auto">{format(value)}</span>
          <span className={styles.track} dir="ltr" aria-hidden="true" data-signed={signed}>
            <span style={{ width: width + "%", left: (signed ? 50 - (value < 0 ? width : 0) : 0) + "%" }} />
          </span>
        </button></li>;
      })}
    </ul>
    <p className={styles.meta} aria-live="polite"><bdi>{block.values[active].label}</bdi> · <bdi>{format(block.values[active].value)}</bdi></p>
  </>;
}

function KnowledgeCheck({ block, ar }: { block: Extract<TeachingBlock, { type: "interactive_check" }>; ar: boolean }) {
  const [selected, setSelected] = useState<number>();
  return <fieldset className={styles.check}>
    <legend>{block.question}</legend>
    <ul>{block.choices.map((choice, index) => <li key={choice}>
      <button type="button" className={styles.choice} aria-pressed={selected === index} onClick={() => setSelected(index)}>{choice}</button>
    </li>)}</ul>
    {selected !== undefined && <p role="status">{selected === block.correct ? (ar ? "إجابة صحيحة. " : "Correct. ") : (ar ? "حاول مرة أخرى." : "Try again.")}{selected === block.correct && block.explanation}</p>}
  </fieldset>;
}

function StudyVisual({ block, language, source, onSourceOpen }: { block: VisualBlock; language: StudyLanguage; source?: SourceCitation; onSourceOpen?: SourceOpen }) {
  const ar = language === "ar";
  const graph = block.type === "diagram" ? block : block.type === "mermaid" ? mermaidGraph(block.flow) : null;
  return <figure className={styles.visual}>
    <figcaption><strong>{block.title}</strong>
      <p>{block.description}</p>
      {source ? <CitationLink source={source} onSourceOpen={onSourceOpen}>{ar ? "راجع المصدر" : "View source"} · {ar ? "صفحة" : "Page"} {source.page}</CitationLink>
        : <span className={styles.meta}>{ar ? "مثال توضيحي" : "Illustrative example"}</span>}
    </figcaption>
    {graph && <FlowDiagram graph={graph} ar={ar} />}
    {block.type === "chart" && <DataChart block={block} language={language} />}
    {block.type === "timeline" && <ol className={styles.timeline}>{block.milestones.map(({ label, detail }, index) => <li key={index}><strong>{label}</strong><p>{detail}</p></li>)}</ol>}
    {block.type === "comparison_table" && <div className={styles.tableWrap} role="region" aria-label={block.title} tabIndex={0}>
      <table><thead><tr>{block.columns.map((column, index) => <th key={index} scope="col">{column}</th>)}</tr></thead>
        <tbody>{block.rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody>
      </table>
    </div>}
  </figure>;
}

export function TeachingReply({ content, citations, language, onSourceOpen, renderIllustration }: {
  content: string; citations?: SourceCitation[]; language: StudyLanguage; onSourceOpen?: SourceOpen;
  renderIllustration?: (block: Illustration, index: number) => ReactNode;
}) {
  const { markdown, blocks } = splitTeachingAnswer(content);
  const sources = new Map((citations ?? []).flatMap((source) => source.label ? [[source.label, source] as const] : []));
  const format = replyMarkdown(sources, onSourceOpen);
  const ar = language === "ar";
  function list(items: string[], numbered: boolean) {
    const List = numbered ? "ol" : "ul";
    return <List>{items.map((item, index) => <li key={index}>{format(item)}</li>)}</List>;
  }
  function blockView(block: TeachingBlock, index: number) {
    switch (block.type) {
      case "paragraph": return format(block.text);
      case "heading": return <h3>{block.text}</h3>;
      case "numbered_steps": return list(block.items, true);
      case "bullet_list": return list(block.items, false);
      case "equation": return <div className={styles.visual}>
        {format("$$\n" + block.latex + "\n$$")}
        {block.explanation && format(block.explanation)}
        {block.steps?.length ? list(block.steps, true) : null}
      </div>;
      case "code_example": return <div><span className={styles.meta}>{block.language}</span><pre><code>{block.code}</code></pre>{block.explanation && format(block.explanation)}</div>;
      case "worked_example": return <section className={styles.visual}><h3>{block.title}</h3>{format(block.problem)}{list(block.steps, true)}</section>;
      case "practice_question": return <section className={styles.visual}>
        <h3>{ar ? "جرّب بنفسك" : "Try it yourself"}</h3>{format(block.question)}
        {block.hint && <details><summary>{ar ? "تلميح" : "Hint"}</summary>{format(block.hint)}</details>}
        {block.answer && <details><summary>{ar ? "عرض الإجابة" : "Show answer"}</summary>{format(block.answer)}</details>}
      </section>;
      case "interactive_check": return <KnowledgeCheck block={block} ar={ar} />;
      case "source_citation": case "document_excerpt": {
        const source = sources.get(block.source);
        if (!source) return null;
        const excerpt = block.type === "document_excerpt";
        const link = <CitationLink source={source} onSourceOpen={onSourceOpen}>{excerpt ? (ar ? "عرض صورة الصفحة الأصليّة" : "View original page image") : source.title} · {ar ? "صفحة" : "Page"} {source.page}</CitationLink>;
        return excerpt ? <figure className={styles.visual}>
          <figcaption><strong>{source.title}</strong><blockquote dir="auto">{source.text.slice(0, 340)}{source.text.length > 340 ? "…" : ""}</blockquote>{link}</figcaption>
        </figure> : link;
      }
      case "illustration": return renderIllustration?.(block, index);
      default: {
        const source = block.grounding.kind === "source" ? sources.get(block.grounding.source) : undefined;
        if (block.grounding.kind === "source" && !source) return null;
        return <StudyVisual block={block} language={language} source={source} onSourceOpen={onSourceOpen} />;
      }
    }
  }
  return <>{markdown && format(markdown)}{blocks.map((block, index) => <div key={index} className={styles.block}>{blockView(block, index)}</div>)}</>;
}
