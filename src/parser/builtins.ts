import type {
  CommandDefinition,
  EnvironmentDefinition,
  ContactField,
  Node,
  ColumnNode,
  ListItemNode,
  Position,
  SourceRange,
  FieldMap,
  Diagnostic,
} from "../types/index.js";
import { DiagnosticSeverity, DiagnosticCode } from "../types/diagnostics.js";
import { CommandRegistry } from "./registry.js";
import { parseKeyValArg, parseListArg } from "./args.js";
import { hasIcon } from "../icons/icons.js";

/* ----------------------------- typography ----------------------------- */
/*
 * The core ships only structural markup and *basic* text emphasis. Decorative
 * typography is opt-in via libraries: color (`\textcolor`, `\themecolor`) lives
 * in the `colors` library; font changes (`\fontfamily`, `\fontsize`, size
 * switches, `\ttfamily`) live in the `fonts` library. Import them with
 * `\usepackage{...}` or `engine.use(...)`. See `src/library`.
 */

const mark = (
  name: string,
  type: "bold" | "italic" | "underline" | "strike",
  summary: string,
): CommandDefinition => ({
  name,
  category: "inline",
  args: [{ kind: "content", name: "content" }],
  summary,
  example: `\\${name}{...}`,
  build: ({ args }) => ({ type, children: args[0]?.children ?? [] }) as Node,
});

const TYPOGRAPHY: CommandDefinition[] = [
  mark("textbf", "bold", "Bold text."),
  mark("textit", "italic", "Italic text."),
  mark("emph", "italic", "Emphasized (italic) text."),
  mark("underline", "underline", "Underlined text."),
  mark("sout", "strike", "Struck-through text."),

  {
    name: "bfseries",
    category: "switch",
    scoped: true,
    summary: "Switch to bold for the rest of the group.",
    build: ({ scope }) => ({ type: "bold", children: scope }),
  },
  {
    name: "itshape",
    category: "switch",
    scoped: true,
    summary: "Switch to italic for the rest of the group.",
    build: ({ scope }) => ({ type: "italic", children: scope }),
  },
];

/* ------------------------------ directives ---------------------------- */

const DIRECTIVES: CommandDefinition[] = [
  {
    name: "usepackage",
    category: "meta",
    args: [{ kind: "list", name: "libraries" }],
    summary: "Import styling libraries (fonts, shapes, colors, modern, …).",
    documentation:
      "ReTeX is blank by default. `\\usepackage{...}` activates one or more " +
      "libraries for this document so their commands and styling become " +
      "available. Multiple libraries can be comma-separated.",
    example: "\\usepackage{shapes, colors}",
    build: ({ args }) => ({
      type: "usepackage",
      names: parseListArg(args[0]?.raw ?? ""),
    }),
  },
  {
    name: "use",
    category: "meta",
    args: [{ kind: "list", name: "libraries" }],
    summary: "Alias for \\usepackage — import styling libraries.",
    example: "\\use{fonts}",
    build: ({ args }) => ({
      type: "usepackage",
      names: parseListArg(args[0]?.raw ?? ""),
    }),
  },
];

/* ------------------------------ hyperlinks ---------------------------- */

const LINKS: CommandDefinition[] = [
  {
    name: "href",
    category: "inline",
    args: [
      { kind: "string", name: "url", format: "url" },
      { kind: "content", name: "label" },
    ],
    summary: "A hyperlink with custom label text.",
    example: "\\href{https://github.com/you}{GitHub}",
    build: ({ args, utils }) => {
      const raw = utils.textOf(args[0]).trim();
      return {
        type: "link",
        href: utils.safeUrl(raw),
        rawHref: raw,
        children: args[1]?.children ?? [],
      };
    },
  },
  {
    name: "url",
    category: "inline",
    args: [{ kind: "string", name: "url", format: "url" }],
    summary: "A hyperlink that displays its own URL.",
    example: "\\url{https://linkedin.com/in/you}",
    build: ({ args, utils }) => {
      const raw = utils.textOf(args[0]).trim();
      return { type: "url", href: utils.safeUrl(raw), rawHref: raw };
    },
  },
];

/* ------------------------------- sections ----------------------------- */

const SECTIONS: CommandDefinition[] = [
  {
    name: "section",
    category: "block",
    args: [{ kind: "string", name: "title" }],
    summary: "A top-level resume section.",
    example: "\\section{Experience}",
    build: ({ args, utils }) => ({
      type: "section",
      title: utils.textOf(args[0]).trim(),
      level: 1,
    }),
  },
  {
    name: "subsection",
    category: "block",
    args: [{ kind: "string", name: "title" }],
    summary: "A second-level section heading.",
    example: "\\subsection{Open Source}",
    build: ({ args, utils }) => ({
      type: "section",
      title: utils.textOf(args[0]).trim(),
      level: 2,
    }),
  },
];

/* --------------------------- contact / header ------------------------- */

const CONTACT_FIELDS: Array<{ cmd: string; field: ContactField; summary: string }> = [
  { cmd: "name", field: "name", summary: "Your full name (document header)." },
  { cmd: "title", field: "title", summary: "Professional headline / role." },
  { cmd: "email", field: "email", summary: "Contact email (rendered as a mailto link)." },
  { cmd: "phone", field: "phone", summary: "Contact phone number." },
  { cmd: "location", field: "location", summary: "City / location." },
  { cmd: "website", field: "website", summary: "Personal website (rendered as a link)." },
];

const CONTACT: CommandDefinition[] = CONTACT_FIELDS.map(({ cmd, field, summary }) => ({
  name: cmd,
  category: "meta",
  args: [{ kind: "string", name: cmd }],
  summary,
  example: `\\${cmd}{...}`,
  build: ({ args, utils }) =>
    ({ type: "contact", field, value: utils.textOf(args[0]).trim() }) as Node,
}));

/* --------------------------- resume entries --------------------------- */

const zero: Position = { offset: 0, line: 1, column: 1 };
const ZERO_RANGE: SourceRange = { start: zero, end: zero };

type Report = (d: Omit<Diagnostic, "source">) => void;

const requireFields = (
  report: Report,
  fields: FieldMap,
  required: string[],
  range: SourceRange,
): void => {
  for (const key of required) {
    if (!fields[key]) {
      report({
        severity: DiagnosticSeverity.Warning,
        code: DiagnosticCode.MissingRequiredField,
        message: `Missing recommended field "${key}".`,
        range,
      });
    }
  }
};

const ENTRIES: CommandDefinition[] = [
  {
    name: "job",
    category: "block",
    args: [
      { kind: "keyval", name: "fields" },
      { kind: "content", name: "body", optional: true },
    ],
    summary: "A work-experience entry.",
    example:
      "\\job{title=Senior Engineer, company=OpenAI, start=2023, end=Present}{Built AI systems}",
    build: ({ args, report }) => {
      const fields = parseKeyValArg(args[0]?.raw ?? "");
      const r = args[0]?.range ?? ZERO_RANGE;
      requireFields(report, fields, ["title", "company"], r);
      return { type: "job", fields, children: args[1]?.children ?? [] };
    },
  },
  {
    name: "education",
    category: "block",
    args: [
      { kind: "keyval", name: "fields" },
      { kind: "content", name: "body", optional: true },
    ],
    summary: "An education entry.",
    example: "\\education{school=MIT, degree=BS Computer Science, start=2018, end=2022}",
    build: ({ args, report }) => {
      const fields = parseKeyValArg(args[0]?.raw ?? "");
      const r = args[0]?.range ?? ZERO_RANGE;
      requireFields(report, fields, ["school", "degree"], r);
      return { type: "education", fields, children: args[1]?.children ?? [] };
    },
  },
  {
    name: "project",
    category: "block",
    args: [
      { kind: "keyval", name: "fields" },
      { kind: "content", name: "body", optional: true },
    ],
    summary: "A project entry.",
    example: "\\project{name=ReTeX, url=https://github.com/you/retex}{A resume engine}",
    build: ({ args, report }) => {
      const fields = parseKeyValArg(args[0]?.raw ?? "");
      const r = args[0]?.range ?? ZERO_RANGE;
      requireFields(report, fields, ["name"], r);
      return { type: "project", fields, children: args[1]?.children ?? [] };
    },
  },
  {
    name: "skills",
    category: "block",
    args: [{ kind: "list", name: "skills" }],
    summary: "A comma-separated list of skills.",
    example: "\\skills{JavaScript, TypeScript, React, Node.js, AWS}",
    build: ({ args }) => ({ type: "skills", items: parseListArg(args[0]?.raw ?? "") }),
  },
];

/* -------------------------------- icons ------------------------------- */

const ICONS: CommandDefinition[] = [
  {
    name: "icon",
    category: "inline",
    args: [{ kind: "string", name: "name" }],
    summary: "Inline SVG icon (github, linkedin, email, phone, …).",
    example: "\\icon{github}",
    build: ({ args, utils, report }) => {
      const name = utils.textOf(args[0]).trim().toLowerCase();
      if (name && !hasIcon(name)) {
        report({
          severity: DiagnosticSeverity.Info,
          code: DiagnosticCode.UnknownIcon,
          message: `Unknown icon "${name}".`,
          range: args[0]?.range ?? ZERO_RANGE,
        });
      }
      return { type: "icon", name };
    },
  },
];

/* ------------------------------ primitives ---------------------------- */
/*
 * Horizontal rules (`\hrule`, `\divider`) and explicit spacing (`\vspace`,
 * `\hspace`) are "shapes" — they live in the `shapes` library, not the core.
 */

const PRIMITIVES: CommandDefinition[] = [
  {
    name: "newline",
    category: "inline",
    summary: "An explicit line break.",
    build: () => ({ type: "linebreak" }),
  },
  {
    name: "linebreak",
    category: "inline",
    summary: "An explicit line break.",
    build: () => ({ type: "linebreak" }),
  },
  // `\item` and `\column` are consumed by their environments; they are
  // registered so they are recognized (and so the validator can flag misuse
  // outside the right environment) but have no standalone builder.
  {
    name: "item",
    category: "block",
    summary: "A list item (inside itemize/enumerate).",
    example: "\\item Built distributed systems",
  },
  {
    name: "column",
    category: "block",
    args: [{ kind: "string", name: "width", format: "dimension" }],
    summary: "A column (inside the columns environment).",
    example: "\\column{40%}",
  },
];

/* ----------------------------- environments --------------------------- */

/**
 * Full source span of an `itemCommand` entry: from the marker (`\item` /
 * `\column`) to the end of its content. Gives list items and columns a precise
 * range so source-mapped HTML (two-way preview) and `nodePathAt` can target an
 * individual entry, not just the enclosing environment.
 */
function entryRange(e: {
  marker: { range?: SourceRange };
  content: Node[];
}): SourceRange | undefined {
  const start = e.marker.range?.start;
  if (!start) return undefined;
  let end: Position | undefined = e.marker.range?.end;
  for (const n of e.content) if (n.range) end = n.range.end;
  return end ? { start, end } : undefined;
}

const ENVIRONMENTS: EnvironmentDefinition[] = [
  {
    name: "itemize",
    itemCommand: "item",
    allowedChildren: ["item"],
    summary: "A bulleted list.",
    example: "\\begin{itemize}\n  \\item ...\n\\end{itemize}",
    build: ({ entries }) => ({
      type: "list",
      kind: "itemize",
      items: (entries ?? []).map(
        (e): ListItemNode => ({
          type: "item",
          children: e.content,
          range: entryRange(e),
        }),
      ),
    }),
  },
  {
    name: "enumerate",
    itemCommand: "item",
    allowedChildren: ["item"],
    summary: "A numbered list.",
    example: "\\begin{enumerate}\n  \\item ...\n\\end{enumerate}",
    build: ({ entries }) => ({
      type: "list",
      kind: "enumerate",
      items: (entries ?? []).map(
        (e): ListItemNode => ({
          type: "item",
          children: e.content,
          range: entryRange(e),
        }),
      ),
    }),
  },
  {
    name: "columns",
    itemCommand: "column",
    allowedChildren: ["column"],
    summary: "A multi-column layout.",
    example:
      "\\begin{columns}\n  \\column{40%} Left\n  \\column{60%} Right\n\\end{columns}",
    build: ({ entries, utils }) => ({
      type: "columns",
      columns: (entries ?? []).map((e): ColumnNode => {
        const width = utils.textOf(e.marker.args[0]).trim() || "auto";
        return { type: "column", width, children: e.content, range: entryRange(e) };
      }),
    }),
  },
  {
    name: "center",
    summary: "Center-align the contained block content.",
    example: "\\begin{center} ... \\end{center}",
    build: ({ body }) => ({
      type: "command",
      name: "center",
      args: [{ kind: "required", children: body }],
    }),
  },
];

/**
 * Register every built-in (core) command and environment into a fresh registry.
 * The core is intentionally minimal: document structure, basic emphasis, links,
 * sections, entries, icons, and the `\usepackage` directive. Visual styling
 * (color, fonts, shapes) is added by libraries — see `src/library`.
 *
 * The engine calls this once per instance so plugins/libraries can extend a
 * private copy without touching global state.
 */
export function createDefaultRegistry(): CommandRegistry {
  const registry = new CommandRegistry();
  for (const def of [
    ...TYPOGRAPHY,
    ...DIRECTIVES,
    ...LINKS,
    ...SECTIONS,
    ...CONTACT,
    ...ENTRIES,
    ...ICONS,
    ...PRIMITIVES,
  ]) {
    registry.registerCommand(def);
  }
  for (const env of ENVIRONMENTS) registry.registerEnvironment(env);
  return registry;
}
