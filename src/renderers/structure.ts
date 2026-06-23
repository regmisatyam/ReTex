import type { Node, SectionNode, ContactNode, FieldMap } from "../types/index.js";

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
  const other = nodes.filter(
    (n) =>
      !CONTACTISH.has(n.type) &&
      n.type !== "parbreak" &&
      n.type !== "usepackage" &&
      !(n.type === "text" && n.value.trim() === ""),
  );
  return { name, title, contacts, other };
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
