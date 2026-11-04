import type {
  Node,
  SectionNode,
  ContactNode,
  FieldMap,
  AuthorNode,
  AbstractNode,
  KeywordsNode,
  Theme,
} from "../types/index.js";
import { collect } from "../ast/walk.js";
import { estimateMathWidth } from "../math/index.js";

/** A document region: an optional leading section heading plus its body. */
export interface Region {
  section?: SectionNode;
  nodes: Node[];
}

/** Split a document's children into regions delimited by level-1 sections. */
export function toRegions(children: Node[]): Region[] {
  const regions: Region[] = [{ nodes: [] }];
  for (const node of children) {
    if (node.type === "section" && node.level === 1) {
      regions.push({ section: node, nodes: [] });
    } else {
      regions[regions.length - 1]!.nodes.push(node);
    }
  }
  return regions;
}

export const CONTACTISH = new Set(["contact", "icon", "link", "url"]);

export interface PreambleParts {
  name?: ContactNode;
  title?: ContactNode;
  contacts: Node[];
  other: Node[];
}

/** Separate a preamble into header pieces (name/title/contacts) and the rest. */
export function splitPreamble(nodes: Node[]): PreambleParts {
  const name = nodes.find(
    (n): n is ContactNode => n.type === "contact" && n.field === "name",
  );
  const title = nodes.find(
    (n): n is ContactNode => n.type === "contact" && n.field === "title",
  );
  const contacts = nodes.filter(
    (n) => CONTACTISH.has(n.type) && n !== name && n !== title,
  );
  // Whitespace and paragraph breaks stay: they separate the words and paragraphs of
  // any text here. A renderer drops a paragraph that turns out to hold nothing.
  const other = nodes.filter((n) => !CONTACTISH.has(n.type) && n.type !== "usepackage");
  return { name, title, contacts, other };
}

export interface PaperFront {
  title?: ContactNode;
  authors: AuthorNode[];
  date?: ContactNode;
  /** Remaining contact fields, shown under the authors. */
  contacts: ContactNode[];
  abstracts: AbstractNode[];
  keywords: KeywordsNode[];
  /** Everything else, in source order: the paper's lead-in text. */
  rest: Node[];
}

/**
 * Separate a paper's preamble into its front matter and lead-in text. Unlike
 * {@link splitPreamble}, links stay in the flow: in a paper, a link before the
 * first section is part of a sentence rather than a contact detail.
 */
export function splitPaperFront(nodes: Node[]): PaperFront {
  const front: PaperFront = {
    authors: [],
    contacts: [],
    abstracts: [],
    keywords: [],
    rest: [],
  };
  for (const node of nodes) {
    switch (node.type) {
      case "usepackage":
        break;
      case "author":
        front.authors.push(node);
        break;
      case "abstract":
        front.abstracts.push(node);
        break;
      case "keywords":
        front.keywords.push(node);
        break;
      case "contact":
        if (node.field === "title" && !front.title) front.title = node;
        else if (node.field === "date" && !front.date) front.date = node;
        else if (node.field === "name") {
          // `\name` is the resume spelling of an author.
          front.authors.push({ type: "author", fields: { name: node.value } });
        } else front.contacts.push(node);
        break;
      default:
        front.rest.push(node);
    }
  }
  return front;
}

/** The lines shown under an author's name, most specific first. */
export function authorDetails(fields: FieldMap): string[] {
  const keys = ["department", "affiliation", "institution", "organization", "location"];
  return keys.map((k) => fields[k]).filter((v): v is string => !!v);
}

/** Number each bibliography key by its position in the document. */
export function bibliographyNumbers(ast: Node): Map<string, number> {
  const numbers = new Map<string, number>();
  for (const node of collect(ast, (n) => n.type === "bibitem")) {
    if (node.type === "bibitem" && !numbers.has(node.key)) {
      numbers.set(node.key, numbers.size + 1);
    }
  }
  return numbers;
}

/** About the room, in em, that a numbered equation has in one column of two. */
const COLUMN_EM = 19;
/** About the room, in em, that any equation has across the whole text block. */
const PAGE_EM = 42;
/** Below this a formula gets hard to read, so let it overflow rather than shrink. */
const MIN_EQUATION_SCALE = 0.6;

export interface EquationFit {
  /** Too wide for its column, so it spans the whole page. */
  wide: boolean;
  /** Too wide even for that, so it shrinks by this factor. */
  scale?: number;
}

/**
 * Decide how a display equation fits its page. A browser cannot break or shrink
 * MathML by itself, and a clipped formula silently loses part of the paper.
 */
export function equationFit(mathml: string, theme: Theme): EquationFit {
  if (!theme.paper) return { wide: false };
  const width = estimateMathWidth(mathml);
  const wide = theme.paper.columns === 2 && width > COLUMN_EM;
  if (width <= PAGE_EM) return { wide };
  const scale = Math.max(MIN_EQUATION_SCALE, PAGE_EM / width);
  return { wide, scale: Math.round(scale * 100) / 100 };
}

/** The title to give a standalone page: the paper's own, or the fallback. */
export function documentTitle(ast: Node, fallback: string): string {
  const title = collect(
    ast,
    (n) => n.type === "contact" && (n as ContactNode).field === "title",
  )[0];
  return title?.type === "contact" && title.value ? title.value : fallback;
}

export interface EntryParts {
  title: string;
  subtitle: string;
  dates: string;
  location: string;
  url: string;
}

/** Normalize a job/education/project field map into renderable entry parts. */
export function entryParts(fields: FieldMap, kind: string): EntryParts {
  let title: string;
  let subtitle: string;
  if (kind === "education") {
    // School is the prominent line; the degree is the subtitle.
    title = fields.school ?? fields.degree ?? "";
    subtitle = fields.school ? (fields.degree ?? "") : "";
  } else if (kind === "project") {
    title = fields.name ?? fields.title ?? "";
    subtitle = fields.organization ?? fields.tech ?? "";
  } else {
    title = fields.title ?? fields.role ?? fields.name ?? "";
    subtitle = fields.company ?? fields.organization ?? "";
  }
  return {
    title,
    subtitle,
    dates: dateRange(fields.start, fields.end, fields.date),
    location: fields.location ?? "",
    url: fields.url ?? fields.link ?? "",
  };
}

export function dateRange(start?: string, end?: string, date?: string): string {
  if (date) return date;
  if (start && end) return `${start} – ${end}`;
  return start ?? end ?? "";
}
