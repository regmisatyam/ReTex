import type {
  CommandDefinition,
  EnvironmentDefinition,
  ContactField,
  MarkType,
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
import { hasIcon, iconNames } from "../icons/icons.js";

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

/**
 * Style keywords accepted inside `\text[...]`, mapped to their emphasis mark.
 * Common aliases are included so `\text[b, i]` works like `\text[bold, italic]`.
 */
const STYLE_MARKS: Record<string, MarkType> = {
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
};

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
  mark("textbf", "bold", "Bold text."),
  mark("textit", "italic", "Italic text."),
  mark("emph", "italic", "Emphasized (italic) text."),
  mark("underline", "underline", "Underlined text."),
  mark("sout", "strike", "Struck-through text."),
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
  args: [{ kind: "string", name: cmd }],
  summary: withIcon ? `${summary} Prefixed with its icon.` : summary,
  example: withIcon ? `\\${cmd}-icon{...}` : `\\${cmd}{...}`,
  build: ({ args, utils }) =>
    ({
      type: "contact",
      field,
      value: utils.textOf(args[0]).trim(),
      ...(withIcon ? { icon: true } : {}),
    }) as Node,
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
    ...ICON_VARIANTS,
    ...PRIMITIVES,
  ]) {
    registry.registerCommand(def);
  }
  for (const env of ENVIRONMENTS) registry.registerEnvironment(env);
  return registry;
}
