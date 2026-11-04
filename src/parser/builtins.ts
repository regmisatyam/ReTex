import type {
  CommandDefinition,
  EnvironmentDefinition,
  ContactField,
  MarkType,
  Node,
  ColumnNode,
  ListItemNode,
  TableAlign,
  TableRowNode,
  CaptionNode,
  ArgumentNode,
  Position,
  SourceRange,
  FieldMap,
  Diagnostic,
} from "../types/index.js";
import { DiagnosticSeverity, DiagnosticCode } from "../types/diagnostics.js";
import { CommandRegistry } from "./registry.js";
import { parseKeyValArg, parseListArg } from "./args.js";
import { hasIcon, iconNames } from "../icons/icons.js";
import { flattenText } from "../ast/text.js";
import { sanitizeImageUrl } from "../security/sanitize.js";
import { isBlockNode } from "../renderers/context.js";

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
  type: MarkType,
  summary: string,
): CommandDefinition => ({
  name,
  category: "inline",
  args: [{ kind: "content", name: "content" }],
  summary,
  example: `\\${name}{...}`,
  build: ({ args }) => ({ type, children: args[0]?.children ?? [] }) as Node,
});

/**
 * Style keywords accepted inside `\text[...]`, mapped to their emphasis mark.
 * Common aliases are included so `\text[b, i]` works like `\text[bold, italic]`.
 */
const STYLE_MARKS = Object.assign(Object.create(null) as Record<string, MarkType>, {
  bold: "bold",
  b: "bold",
  bf: "bold",
  strong: "bold",
  italic: "italic",
  i: "italic",
  it: "italic",
  em: "italic",
  emph: "italic",
  underline: "underline",
  u: "underline",
  strike: "strike",
  strikethrough: "strike",
  s: "strike",
  sout: "strike",
  del: "strike",
  sub: "sub",
  subscript: "sub",
  sup: "sup",
  superscript: "sup",
} satisfies Record<string, MarkType>);

const ZERO_POS: Position = { offset: 0, line: 1, column: 1 };
const STYLE_ZERO_RANGE: SourceRange = { start: ZERO_POS, end: ZERO_POS };

/**
 * `\text[bold, italic]{...}` — apply several emphasis styles at once. The styles
 * listed in `[...]` are nested in order (first = outermost) so they combine,
 * e.g. bold *and* italic. With no `[...]` it is a plain pass-through group, so
 * `\text{...}` is always safe. Unlike `\textbf`/`\textit`, this composes.
 */
const textStyled: CommandDefinition = {
  name: "text",
  category: "inline",
  args: [
    { kind: "list", name: "styles", optional: true, delimiter: "bracket" },
    { kind: "content", name: "content" },
  ],
  summary: "Apply one or more text styles at once, e.g. \\text[bold, italic]{...}.",
  documentation:
    "Combines basic emphasis styles in a single command. List any of `bold`, " +
    "`italic`, `underline`, `strike` (and aliases like `b`, `i`, `u`, `s`) " +
    "inside `[...]`; they nest in order so `\\text[bold, italic]{Hi}` renders " +
    "bold *and* italic. With no `[...]`, `\\text{...}` is a plain group.",
  example: "\\text[bold, italic]{Hello}",
  build: ({ args, report }) => {
    const styleArg = args.find((a) => a.kind === "optional");
    const contentArg = args.find((a) => a.kind === "required");
    const styles = parseListArg(styleArg?.raw ?? "");
    let nodes: Node[] = contentArg?.children ?? [];
    let wrapped = false;
    // Apply right-to-left so the first listed style ends up outermost.
    for (let i = styles.length - 1; i >= 0; i--) {
      const type = STYLE_MARKS[styles[i]!.toLowerCase()];
      if (!type) {
        report({
          severity: DiagnosticSeverity.Warning,
          code: DiagnosticCode.UnknownCommand,
          message: `Unknown text style "${styles[i]}". Use bold, italic, underline, or strike.`,
          range: styleArg?.range ?? STYLE_ZERO_RANGE,
        });
        continue;
      }
      nodes = [{ type, children: nodes } as Node];
      wrapped = true;
    }
    return wrapped ? nodes[0]! : ({ type: "group", children: nodes } as Node);
  },
};

const TYPOGRAPHY: CommandDefinition[] = [
  {
    // `\\\\` is a line break, so a literal backslash needs its own command.
    name: "textbackslash",
    category: "inline",
    args: [{ kind: "string", name: "following", optional: true }],
    summary: "A literal backslash character.",
    example: "C:\\textbackslash{}Users",
    build: ({ args }) => ({ type: "text", value: `\\${args[0]?.raw ?? ""}` }),
  },
  mark("textbf", "bold", "Bold text."),
  mark("textit", "italic", "Italic text."),
  mark("emph", "italic", "Emphasized (italic) text."),
  mark("underline", "underline", "Underlined text."),
  mark("sout", "strike", "Struck-through text."),
  mark("textsubscript", "sub", "Subscript text."),
  mark("textsuperscript", "sup", "Superscript text."),
  textStyled,

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

/** Flags accepted in `\\documentclass[...]`; applied by the paper theme helper. */
const DOCUMENT_CLASS_OPTIONS = new Set([
  "onecolumn",
  "twocolumn",
  "a4paper",
  "letterpaper",
  "10pt",
  "11pt",
  "12pt",
  "numbered",
  "nonumbers",
]);

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
    name: "documentclass",
    category: "meta",
    args: [
      { kind: "list", name: "options", optional: true, delimiter: "bracket" },
      { kind: "string", name: "style" },
    ],
    summary: "Choose a paper style (normal, ieee, acm, arxiv, lncs, apa, journal).",
    documentation:
      "Sets the look of the whole paper. Optional flags adjust the chosen style: " +
      "`onecolumn`, `twocolumn`, `a4paper`, `letterpaper`, `10pt`, `11pt`, `12pt`, " +
      "`numbered`, `nonumbers`.",
    example: "\\documentclass[twocolumn, a4paper]{ieee}",
    build: ({ args, utils, report }) => {
      const optionArg = args.find((a) => a.kind === "optional");
      const styleArg = args.find((a) => a.kind === "required");
      const options = parseListArg(optionArg?.raw ?? "");
      for (const option of options) {
        if (DOCUMENT_CLASS_OPTIONS.has(option.toLowerCase())) continue;
        report({
          severity: DiagnosticSeverity.Warning,
          code: DiagnosticCode.UnknownOption,
          message: `Unknown \\documentclass option "${option}". Use ${[...DOCUMENT_CLASS_OPTIONS].join(", ")}.`,
          range: optionArg?.range ?? ZERO_RANGE,
        });
      }
      return {
        type: "usepackage",
        names: parseListArg(utils.textOf(styleArg)),
        documentClass: true,
        ...(options.length > 0 ? { options } : {}),
      };
    },
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

/** True when a title holds markup that a plain string could not represent. */
const hasRichContent = (nodes: Node[]): boolean =>
  nodes.some((n) => n.type !== "text" && n.type !== "group");

const trimInline = (nodes: Node[]): Node[] => {
  const out = [...nodes];
  const blank = (n: Node | undefined): boolean =>
    n?.type === "text" && n.value.trim() === "";
  while (blank(out[0])) out.shift();
  while (blank(out[out.length - 1])) out.pop();
  return out;
};

const sectionCommand = (
  name: string,
  level: number,
  summary: string,
  unnumbered: boolean,
): CommandDefinition => ({
  name,
  category: "block",
  args: [{ kind: "content", name: "title" }],
  summary,
  example: `\\${name}{Experience}`,
  build: ({ args }) => {
    const children = trimInline(args[0]?.children ?? []);
    return {
      type: "section",
      title: flattenText(children).trim(),
      level,
      ...(hasRichContent(children) ? { children } : {}),
      ...(unnumbered ? { unnumbered: true } : {}),
    };
  },
});

const SECTION_LEVELS: Array<[string, number, string]> = [
  ["section", 1, "A top-level section."],
  ["subsection", 2, "A second-level section heading."],
  ["subsubsection", 3, "A third-level section heading."],
  ["paragraph", 4, "A fourth-level heading, for the smallest labelled unit."],
];

const SECTIONS: CommandDefinition[] = SECTION_LEVELS.flatMap(([name, level, summary]) => [
  sectionCommand(name, level, summary, false),
  sectionCommand(`${name}*`, level, `${summary} Never numbered.`, true),
]);

/* --------------------------- contact / header ------------------------- */

const CONTACT_FIELDS: Array<{
  cmd: string;
  field: ContactField;
  summary: string;
  /** Whether the field has an associated glyph (and thus an `-icon` variant). */
  hasIcon?: boolean;
}> = [
  { cmd: "name", field: "name", summary: "Your full name (document header)." },
  { cmd: "title", field: "title", summary: "Professional headline / role." },
  {
    cmd: "email",
    field: "email",
    summary: "Contact email (rendered as a mailto link).",
    hasIcon: true,
  },
  { cmd: "phone", field: "phone", summary: "Contact phone number.", hasIcon: true },
  { cmd: "location", field: "location", summary: "City / location.", hasIcon: true },
  {
    cmd: "website",
    field: "website",
    summary: "Personal website (rendered as a link).",
    hasIcon: true,
  },
  { cmd: "date", field: "date", summary: "Publication date (paper header)." },
];

/**
 * Build a contact command. Icons are opt-in: the plain `\email{…}` renders the
 * value only; the `\email-icon{…}` variant sets `icon` so the renderer prepends
 * the glyph. `\name`/`\title` have no glyph, so they get no `-icon` variant.
 */
const contactCommand = (
  cmd: string,
  field: ContactField,
  summary: string,
  withIcon: boolean,
): CommandDefinition => ({
  name: withIcon ? `${cmd}-icon` : cmd,
  category: "meta",
  // A paper title can hold formulas, so `\\title` parses its content.
  args: [{ kind: field === "title" ? "content" : "string", name: cmd }],
  summary: withIcon ? `${summary} Prefixed with its icon.` : summary,
  example: withIcon ? `\\${cmd}-icon{...}` : `\\${cmd}{...}`,
  build: ({ args, utils }) => {
    const children = field === "title" ? trimInline(args[0]?.children ?? []) : [];
    return {
      type: "contact",
      field,
      value: utils.textOf(args[0]).trim(),
      ...(withIcon ? { icon: true } : {}),
      ...(hasRichContent(children) ? { children } : {}),
    } as Node;
  },
});

const CONTACT: CommandDefinition[] = CONTACT_FIELDS.flatMap(
  ({ cmd, field, summary, hasIcon }) => {
    const plain = contactCommand(cmd, field, summary, false);
    return hasIcon ? [plain, contactCommand(cmd, field, summary, true)] : [plain];
  },
);

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

/* -------------------------------- papers ------------------------------ */

/** Undo the escapes `\\code{...}` needs for its own delimiters. */
const unescapeCode = (raw: string): string => raw.replace(/\\([{}\\%])/g, "$1");

const PAPER: CommandDefinition[] = [
  {
    name: "author",
    category: "meta",
    args: [{ kind: "keyval", name: "author" }],
    summary: "A paper author: a name, or name=, affiliation=, email= fields.",
    example: "\\author{name=Ada Lovelace, affiliation=Analytical Society, email=ada@x.org}",
    build: ({ args }) => {
      const raw = args[0]?.raw ?? "";
      if (raw.includes("=")) {
        return { type: "author", fields: parseKeyValArg(raw) };
      }
      // `\\author{Ada Lovelace, Alan Turing}` is shorthand for one author each.
      return parseListArg(raw).map((name) => ({
        type: "author" as const,
        fields: { name },
      }));
    },
  },
  {
    name: "abstract",
    category: "block",
    args: [{ kind: "content", name: "content" }],
    summary: "The paper's abstract (also available as an environment).",
    example: "\\abstract{We show that ...}",
    build: ({ args }) => ({ type: "abstract", children: args[0]?.children ?? [] }),
  },
  {
    name: "keywords",
    category: "block",
    args: [{ kind: "list", name: "keywords" }],
    summary: "Comma-separated keywords, shown under the abstract.",
    example: "\\keywords{compilers, type systems}",
    build: ({ args }) => ({ type: "keywords", items: parseListArg(args[0]?.raw ?? "") }),
  },
  {
    name: "code",
    category: "inline",
    args: [{ kind: "verbatim", name: "code" }],
    summary: "Inline code. Write \\{, \\}, \\\\ and \\% for those literal characters.",
    example: "\\code{npm install}",
    build: ({ args }) => ({ type: "code", value: unescapeCode(args[0]?.raw ?? "") }),
  },
  {
    name: "math",
    category: "inline",
    args: [{ kind: "verbatim", name: "tex" }],
    summary: "An inline formula, written in TeX.",
    example: "\\math{E = mc^2}",
    build: ({ args }) => ({
      type: "math",
      tex: (args[0]?.raw ?? "").trim(),
      display: false,
    }),
  },
  {
    name: "includegraphics",
    category: "inline",
    args: [
      { kind: "keyval", name: "options", optional: true, delimiter: "bracket" },
      { kind: "string", name: "url", format: "url" },
    ],
    summary: "An image. Options: width=, alt=.",
    example: "\\includegraphics[width=80%, alt=Results chart]{figure.png}",
    build: ({ args, utils, report }) => {
      const optionArg = args.find((a) => a.kind === "optional");
      const urlArg = args.find((a) => a.kind === "required");
      const options = parseKeyValArg(optionArg?.raw ?? "");
      const rawSrc = utils.textOf(urlArg).trim();
      const { safe, blocked, scheme } = sanitizeImageUrl(rawSrc);
      if (blocked) {
        report({
          severity: DiagnosticSeverity.Warning,
          code: DiagnosticCode.UnsafeUrlBlocked,
          message: `Blocked image URL with "${scheme ?? "unknown"}" scheme.`,
          range: urlArg?.range ?? ZERO_RANGE,
        });
      }
      return {
        type: "image",
        src: safe,
        rawSrc,
        alt: options.alt ?? "",
        ...(options.width ? { width: options.width } : {}),
      };
    },
  },
  {
    name: "caption",
    category: "block",
    args: [{ kind: "content", name: "caption" }],
    summary: "The caption of a figure or table.",
    example: "\\caption{Accuracy by model}",
    build: ({ args }) => ({ type: "caption", children: args[0]?.children ?? [] }),
  },
  {
    name: "row",
    category: "block",
    args: [{ kind: "content", name: "cell", variadic: true }],
    summary: "A table row with one {...} per cell (inside the table environment).",
    example: "\\row{BERT}{0.92}{0.91}",
    build: ({ args }) => tableRow(args, false),
  },
  {
    name: "head",
    category: "block",
    args: [{ kind: "content", name: "cell", variadic: true }],
    summary: "A table header row with one {...} per cell.",
    example: "\\head{Model}{Accuracy}{F1}",
    build: ({ args }) => tableRow(args, true),
  },
  {
    name: "footnote",
    category: "inline",
    args: [{ kind: "content", name: "content" }],
    summary: "A numbered note, collected at the end of the document.",
    example: "\\footnote{Measured on the 2023 dataset.}",
    build: ({ args }) => ({ type: "footnote", children: args[0]?.children ?? [] }),
  },
  {
    name: "cite",
    category: "inline",
    args: [{ kind: "list", name: "keys" }],
    summary: "Cite one or more \\bibitem entries by key.",
    example: "\\cite{turing1936, church1936}",
    build: ({ args }) => ({ type: "cite", keys: parseListArg(args[0]?.raw ?? "") }),
  },
  {
    name: "bibitem",
    category: "block",
    args: [{ kind: "string", name: "key" }],
    summary: "A bibliography entry (inside the references environment).",
    example: "\\bibitem{turing1936} A. Turing, On Computable Numbers, 1936.",
  },
];

function tableRow(args: ArgumentNode[], header: boolean): TableRowNode {
  return {
    type: "row",
    cells: args.map((a) => ({ type: "cell", children: trimInline(a.children) })),
    ...(header ? { header: true } : {}),
  };
}

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

/**
 * Per-icon `\<name>-icon{label?}` shortcuts. Icons are always opt-in: typing
 * `\github-icon{}` renders the github glyph (equivalent to `\icon{github}`), and
 * an optional `{label}` is rendered after it. The contact fields (email, phone,
 * location, website) are intentionally skipped — their `-icon` variants are the
 * contact commands above, which keep the value clickable.
 */
const CONTACT_ICON_NAMES = new Set(["email", "phone", "location", "website"]);

const ICON_VARIANTS: CommandDefinition[] = iconNames()
  .filter((name) => !CONTACT_ICON_NAMES.has(name))
  .map((name) => ({
    name: `${name}-icon`,
    category: "inline" as const,
    args: [{ kind: "content" as const, name: "label", optional: true }],
    summary: `Inline ${name} icon (shortcut for \\icon{${name}}).`,
    example: `\\${name}-icon{}`,
    build: ({ args }) => {
      const icon: Node = { type: "icon", name };
      const label = args[0]?.children ?? [];
      return label.length > 0 ? [icon, ...label] : icon;
    },
  }));

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
 * Whitespace next to a nested block separates nothing: it is only how the source
 * was laid out. Dropping it means `\\item a` followed by a sublist on its own line
 * gives the same document as Markdown's tight `- a` with a sublist.
 */
function itemChildren(content: Node[]): Node[] {
  const blank = (n: Node | undefined): boolean =>
    n?.type === "text" && n.value.trim() === "";
  const block = (n: Node | undefined): boolean => n !== undefined && isBlockNode(n);
  const out = content.filter(
    (n, i) => !blank(n) || !(block(content[i - 1]) || block(content[i + 1])),
  );
  while (blank(out[out.length - 1])) out.pop();
  return out;
}

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
          children: itemChildren(e.content),
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
    build: ({ entries, options }) => {
      const start = Number(parseKeyValArg(options[0]?.raw ?? "").start);
      return {
        type: "list",
        kind: "enumerate",
        ...(Number.isInteger(start) && start !== 1 ? { start } : {}),
        items: (entries ?? []).map(
          (e): ListItemNode => ({
            type: "item",
            children: itemChildren(e.content),
            range: entryRange(e),
          }),
        ),
      };
    },
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

/** Parse a column spec such as `l, c, r` or `lcr` from an environment's `[...]`. */
function parseTableAlign(raw: string): TableAlign[] {
  const parts = raw.includes(",") ? parseListArg(raw) : raw.replace(/\s+/g, "").split("");
  return parts.map((p): TableAlign => {
    const name = p.toLowerCase();
    if (name === "c" || name === "center") return "center";
    if (name === "r" || name === "right") return "right";
    return "left";
  });
}

/** The exact text of a verbatim body, without the newlines framing it. */
const verbatimBody = (body: Node[]): string =>
  flattenText(body)
    .replace(/^[ \t]*\n/, "")
    .replace(/\n[ \t]*$/, "");

const codeEnvironment = (name: string, summary: string): EnvironmentDefinition => ({
  name,
  summary,
  example: `\\begin{${name}}\n...\n\\end{${name}}`,
  build: ({ body, options }) => {
    const language = (options[0]?.raw ?? "").trim();
    return {
      type: "codeblock",
      value: verbatimBody(body),
      ...(language ? { language } : {}),
    };
  },
});

const mathEnvironment = (name: string, numbered: boolean): EnvironmentDefinition => ({
  name,
  summary: numbered
    ? "A display equation, numbered when the paper style numbers equations."
    : "A display equation that is never numbered.",
  example: `\\begin{${name}}\n  E = mc^2\n\\end{${name}}`,
  build: ({ body }) => {
    const tex = flattenText(body).trim();
    const alignment = name.replace("*", "");
    return {
      type: "math",
      display: true,
      // Keep the alignment environment so `&` and `\\\\` still mean something.
      tex:
        alignment === "align" || alignment === "gather"
          ? `\\begin{${alignment}}${tex}\\end{${alignment}}`
          : tex,
      ...(numbered ? {} : { numbered: false }),
    };
  },
});

const figureEnvironment = (name: string, wide: boolean): EnvironmentDefinition => ({
  name,
  summary: wide
    ? "A figure spanning every column of the page."
    : "A figure: an image and an optional \\caption.",
  example: `\\begin{${name}}\n  \\includegraphics{plot.png}\n  \\caption{Results}\n\\end{${name}}`,
  build: ({ body }) => ({
    type: "figure",
    children: body.filter((n) => n.type !== "text" || n.value.trim() !== ""),
    ...(wide ? { wide: true } : {}),
  }),
});

const tableEnvironment = (name: string, wide: boolean): EnvironmentDefinition => ({
  name,
  summary: wide
    ? "A table spanning every column of the page."
    : "A table: \\head and \\row lines, plus an optional \\caption.",
  example: `\\begin{${name}}[l, r]\n  \\caption{Results}\n  \\head{Model}{F1}\n  \\row{BERT}{0.91}\n\\end{${name}}`,
  build: ({ body, options }) => ({
    type: "table",
    rows: body.filter((n): n is TableRowNode => n.type === "row"),
    align: parseTableAlign(options[0]?.raw ?? ""),
    ...captionOf(body),
    ...(wide ? { wide: true } : {}),
  }),
});

const captionOf = (body: Node[]): { caption?: CaptionNode } => {
  const caption = body.find((n): n is CaptionNode => n.type === "caption");
  return caption ? { caption } : {};
};

const referencesEnvironment = (name: string): EnvironmentDefinition => ({
  name,
  itemCommand: "bibitem",
  allowedChildren: ["bibitem"],
  summary: "A numbered bibliography. Cite its entries with \\cite{key}.",
  example: `\\begin{${name}}\n  \\bibitem{key} An entry.\n\\end{${name}}`,
  build: ({ entries, utils }) => ({
    type: "references",
    items: (entries ?? []).map((e) => ({
      type: "bibitem" as const,
      key: utils.textOf(e.marker.args[0]).trim(),
      children: e.content,
      range: entryRange(e),
    })),
  }),
});

const PAPER_ENVIRONMENTS: EnvironmentDefinition[] = [
  {
    name: "abstract",
    summary: "The paper's abstract.",
    example: "\\begin{abstract}\n  We show that ...\n\\end{abstract}",
    build: ({ body }) => ({ type: "abstract", children: body }),
  },
  {
    name: "quote",
    summary: "A block quotation.",
    example: "\\begin{quote}\n  ...\n\\end{quote}",
    build: ({ body }) => ({ type: "quote", children: body }),
  },
  codeEnvironment("code", "A code block. Name the language in [...]."),
  codeEnvironment("verbatim", "A block of text shown exactly as written."),
  mathEnvironment("equation", true),
  mathEnvironment("equation*", false),
  mathEnvironment("displaymath", false),
  mathEnvironment("align", true),
  mathEnvironment("align*", false),
  mathEnvironment("gather", true),
  mathEnvironment("gather*", false),
  figureEnvironment("figure", false),
  figureEnvironment("figure*", true),
  tableEnvironment("table", false),
  tableEnvironment("table*", true),
  referencesEnvironment("references"),
  referencesEnvironment("thebibliography"),
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
    ...PAPER,
    ...ICONS,
    ...ICON_VARIANTS,
    ...PRIMITIVES,
  ]) {
    registry.registerCommand(def);
  }
  for (const env of [...ENVIRONMENTS, ...PAPER_ENVIRONMENTS]) {
    registry.registerEnvironment(env);
  }
  return registry;
}
