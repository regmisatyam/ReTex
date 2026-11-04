import { describe, it, expect } from "vitest";
import {
  ReTeXEngine,
  IncrementalCompiler,
  DiagnosticCode,
  DiagnosticSeverity,
  applyPaperOptions,
  collect,
  createPaperStyle,
  getBuiltinLibrary,
  ieeeTheme,
  markdownToHtml,
  markdownToPdf,
  markdownToRetex,
  normalTheme,
  paperStyleNames,
  paperThemes,
  parseMarkdown,
  printDocument,
  type HeadlessBrowser,
  type Node,
} from "../src/index.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const sample = readFileSync(join(here, "..", "examples", "ai-response.md"), "utf8");
const engine = new ReTeXEngine();
const errorsOf = (src: string) =>
  engine.compile(src).diagnostics.filter((d) => d.severity === DiagnosticSeverity.Error);
const nodes = <T extends Node["type"]>(src: string, type: T) =>
  collect(engine.compile(src).ast, (n) => n.type === type) as Array<Extract<Node, { type: T }>>;

describe("language: paper commands", () => {
  it("\\documentclass selects a style and its flags", () => {
    const [node] = nodes("\\documentclass[twocolumn, a4paper]{normal}\nx", "usepackage");
    expect(node).toMatchObject({
      names: ["normal"],
      documentClass: true,
      options: ["twocolumn", "a4paper"],
    });
    const html = engine.toHtmlDocument("\\documentclass[twocolumn, a4paper]{normal}\nx");
    expect(html).toContain("retex-paper--2col");
    expect(html).toContain("size: A4");
  });

  it("warns about an unknown \\documentclass flag or style", () => {
    const flag = engine.compile("\\documentclass[nope]{ieee}").diagnostics;
    expect(flag.map((d) => d.code)).toContain(DiagnosticCode.UnknownOption);
    const style = engine.compile("\\documentclass{nope}").diagnostics;
    expect(style.map((d) => d.code)).toContain(DiagnosticCode.UnknownLibrary);
  });

  it("\\usepackage works for paper styles too", () => {
    expect(engine.toHtml("\\usepackage{ieee}\nx")).toContain("retex-paper--ieee");
  });

  it("paper styles include the styling commands, like other theme packs", () => {
    expect(errorsOf("\\documentclass{ieee}\n\\hrule\n\\textcolor{red}{x}")).toEqual([]);
    expect(engine.toHtml("\\documentclass{ieee}\n\\textcolor{red}{x}")).toContain("color:red");
  });

  it("aliases", () => {
    expect(getBuiltinLibrary("article")?.name).toBe("normal");
    expect(getBuiltinLibrary("springer")?.name).toBe("lncs");
    expect(getBuiltinLibrary("neurips")?.name).toBe("arxiv");
  });

  it("\\section* and deeper levels", () => {
    const sections = nodes(
      "\\section*{A}\\subsection*{B}\\subsubsection{C}\\paragraph{D}",
      "section",
    );
    expect(sections.map((s) => [s.level, s.unnumbered])).toEqual([
      [1, true],
      [2, true],
      [3, undefined],
      [4, undefined],
    ]);
  });

  it("section titles can hold markup, and plain ones stay plain", () => {
    expect(nodes("\\section{Plain \\& simple}", "section")[0]).toEqual(
      expect.objectContaining({ title: "Plain & simple" }),
    );
    expect(nodes("\\section{Plain}", "section")[0]!.children).toBeUndefined();
    const [rich] = nodes("\\section{On \\math{O(n)} time}", "section");
    expect(rich!.title).toBe("On O(n) time");
    expect(engine.toHtml("\\section{On \\math{O(n)} time}")).toContain("<math");
  });

  it("\\author: a name, several names, or fields", () => {
    expect(nodes("\\author{Ada Lovelace}", "author")[0]!.fields).toEqual({
      name: "Ada Lovelace",
    });
    expect(nodes("\\author{Ada, Alan}", "author").map((a) => a.fields.name)).toEqual([
      "Ada",
      "Alan",
    ]);
    expect(
      nodes("\\author{name=Ada, affiliation=MIT, Cambridge, email=a@b.org}", "author")[0]!.fields,
    ).toEqual({ name: "Ada", affiliation: "MIT, Cambridge", email: "a@b.org" });
  });

  it("abstract as a command or environment, and keywords", () => {
    expect(nodes("\\abstract{x}", "abstract")).toHaveLength(1);
    expect(nodes("\\begin{abstract}x\\end{abstract}", "abstract")).toHaveLength(1);
    expect(nodes("\\keywords{a, b}", "keywords")[0]!.items).toEqual(["a", "b"]);
  });

  it("\\code keeps its text, with escapes only for its own delimiters", () => {
    const value = (src: string): string => nodes(src, "code")[0]!.value;
    expect(value("\\code{a_b*c}")).toBe("a_b*c");
    expect(value("\\code{f(x) { y }}")).toBe("f(x) { y }");
    expect(value("\\code{\\{}")).toBe("{");
    expect(value("\\code{\\n}")).toBe("\\n");
    expect(value("\\code{a\\\\b}")).toBe("a\\b");
    expect(value("\\code{[}")).toBe("[");
    expect(errorsOf("\\code{[} after")).toEqual([]);
  });

  it("code environments keep every character", () => {
    const code = "if (x) {\n\n  y = \"\\n\"; // 100%% {\n}\n\\begin{not} [a";
    const [node] = nodes(`\\begin{code}[python]\n${code}\n\\end{code}`, "codeblock");
    expect(node).toMatchObject({ language: "python", value: code });
    expect(nodes("\\begin{verbatim}\n\\x\n\\end{verbatim}", "codeblock")[0]!.value).toBe("\\x");
  });

  it("an unterminated code environment is an error, not a hang", () => {
    expect(errorsOf("\\begin{code}\nfoo").length).toBeGreaterThan(0);
  });

  it("\\math keeps its TeX exactly, including escapes and half-open intervals", () => {
    const tex = (src: string): string => nodes(src, "math")[0]!.tex;
    expect(tex("\\math{x^2}")).toBe("x^2");
    expect(tex("\\math{\\frac{a}{b}}")).toBe("\\frac{a}{b}");
    expect(tex("\\math{\\{x\\}}")).toBe("\\{x\\}");
    expect(tex("\\math{a\\,b}")).toBe("a\\,b");
    expect(tex("\\math{a \\\\ b}")).toBe("a \\\\ b");
    expect(tex("\\math{[0, 1)}")).toBe("[0, 1)");
    expect(tex("\\math{(0, 1]}")).toBe("(0, 1]");
    expect(errorsOf("\\math{[0, 1)} text")).toEqual([]);
  });

  it("equation environments", () => {
    const math = (src: string) => nodes(src, "math")[0]!;
    expect(math("\\begin{equation}\nx\n\\end{equation}")).toMatchObject({
      tex: "x",
      display: true,
    });
    expect(math("\\begin{equation}\nx\n\\end{equation}").numbered).toBeUndefined();
    expect(math("\\begin{equation*}x\\end{equation*}").numbered).toBe(false);
    expect(math("\\begin{displaymath}x\\end{displaymath}").numbered).toBe(false);
    expect(math("\\begin{align}a &= b\\end{align}").tex).toContain("\\begin{align}");
    expect(math("\\begin{equation}\\{ a \\\\ b \\}\\end{equation}").tex).toBe("\\{ a \\\\ b \\}");
  });

  it("$ is still literal in ReTeX source, so resumes keep working", () => {
    expect(nodes("Saved $2M and $3M", "math")).toEqual([]);
    expect(engine.toHtml("Saved $2M and $3M")).toContain("Saved $2M and $3M");
  });

  it("tables", () => {
    const [table] = nodes(
      "\\begin{table}[l, c, r]\n\\caption{Cap}\n\\head{A}{B}{C}\n\\row{1}{\\textbf{2}}{3}\n\\end{table}",
      "table",
    );
    expect(table!.align).toEqual(["left", "center", "right"]);
    expect(table!.rows).toHaveLength(2);
    expect(table!.rows[0]!.header).toBe(true);
    expect(table!.caption).toBeDefined();
    expect(table!.wide).toBeUndefined();
    expect(nodes("\\begin{table*}\\row{a}\\end{table*}", "table")[0]!.wide).toBe(true);
    expect(nodes("\\begin{table}[lcr]\\row{a}\\end{table}", "table")[0]!.align).toEqual([
      "left",
      "center",
      "right",
    ]);
  });

  it("a row with no cells, and rows of different lengths, render", () => {
    expect(() =>
      engine.toHtml("\\begin{table}\\row\\row{a}{b}{c}\\row{d}\\end{table}"),
    ).not.toThrow();
  });

  it("\\row outside a table is an error", () => {
    expect(errorsOf("\\row{a}")).not.toEqual([]);
  });

  it("\\bibitem outside references is an error", () => {
    expect(errorsOf("\\bibitem{a}")).not.toEqual([]);
  });

  it("figures", () => {
    const html = engine.toHtml(
      "\\begin{figure}\n\\includegraphics[width=80%, alt=A plot]{a.png}\n\\caption{Cap}\n\\end{figure}",
    );
    expect(html).toContain("<figure");
    expect(html).toContain('src="a.png"');
    expect(html).toContain('alt="A plot"');
    expect(html).toContain("width:80%");
    expect(html).toContain("<figcaption");
    expect(engine.toHtml("\\begin{figure*}\\includegraphics{a}\\end{figure*}")).toContain(
      "retex-figure--wide",
    );
  });

  it("citations resolve by position and warn when unknown", () => {
    const src =
      "\\cite{b, a}\n\\begin{references}\\bibitem{a} A.\\bibitem{b} B.\\end{references}";
    const html = engine.toHtml(src);
    expect(html).toContain('[<a href="#retex-ref-2">2</a>, <a href="#retex-ref-1">1</a>]');
    expect(html).toContain('id="retex-ref-1"');
    const codes = engine.compile("\\cite{nope}").diagnostics.map((d) => d.code);
    expect(codes).toContain(DiagnosticCode.UnknownCitation);
    expect(engine.toHtml("\\cite{nope}")).toContain("[nope]");
    expect(nodes("\\begin{thebibliography}\\bibitem{a} A.\\end{thebibliography}", "bibitem")).toHaveLength(1);
  });

  it("footnotes number in order, also in ordinary documents", () => {
    const html = engine.toHtml("a\\footnote{one} b\\footnote{two}");
    expect(html).toContain('href="#retex-fn-1"');
    expect(html.indexOf("one")).toBeLessThan(html.indexOf("two"));
    expect(html).toContain("retex-footnotes");
  });

  it("footnote numbers restart on every render", () => {
    const e = new ReTeXEngine();
    const ast = e.compile("a\\footnote{one}").ast;
    expect(e.toHtml(ast)).toBe(e.toHtml(ast));
  });

  it("a footnote inside a footnote is kept", () => {
    const html = engine.toHtml("a\\footnote{one\\footnote{two}}");
    expect(html).toContain("one");
    expect(html).toContain("two");
    expect(html).toContain('id="retex-fn-2"');
  });

  it("unsupported math is reported", () => {
    const codes = engine.compile("\\math{\\nosuch}").diagnostics.map((d) => d.code);
    expect(codes).toContain(DiagnosticCode.UnsupportedMath);
  });

  it("sub and superscript, including through \\text", () => {
    expect(engine.toHtml("\\textsubscript{a}\\textsuperscript{b}")).toContain(
      "<sub>a</sub><sup>b</sup>",
    );
    expect(engine.toHtml("\\text[sup, bold]{a}")).toContain("<sup><strong>a</strong></sup>");
  });

  it("enumerate can start anywhere", () => {
    expect(engine.toHtml("\\begin{enumerate}[start=3]\\item a\\end{enumerate}")).toContain(
      'start="3"',
    );
  });
});

describe("paper layout", () => {
  const paper = "\\documentclass{ieee}\n\\title{T}\n\\author{A}\n\\date{D}\n\\abstract{Abs}\n\\keywords{k}\nLead \\href{https://x.org}{link} text.\n\n\\section{S}\nBody";

  it("every style has a theme, a library, and a stylesheet", () => {
    expect(paperStyleNames()).toEqual(["normal", "ieee", "acm", "arxiv", "lncs", "apa", "journal"]);
    for (const name of paperStyleNames()) {
      expect(getBuiltinLibrary(name)?.theme?.paper?.variant, name).toBe(name);
      const css = engine.styles(`\\documentclass{${name}}`);
      expect(css, name).toContain(`.retex-paper--${name}`);
    }
  });

  it("two-column styles are two columns, and others are not", () => {
    const columns = Object.entries(paperThemes)
      .filter(([, t]) => t.paper?.columns === 2)
      .map(([n]) => n);
    expect(columns).toEqual(["ieee", "acm", "journal"]);
    expect(engine.toHtml("\\documentclass{ieee}\nx")).toContain("retex-paper--2col");
    expect(engine.toHtml("\\documentclass{normal}\nx")).not.toContain("retex-paper--2col");
    expect(engine.styles("\\documentclass{ieee}\nx")).toContain("column-count: 2");
  });

  it("flags override the style in both directions", () => {
    expect(engine.toHtml("\\documentclass[onecolumn]{ieee}\nx")).not.toContain("--2col");
    expect(engine.toHtml("\\documentclass[twocolumn]{normal}\nx")).toContain("--2col");
    expect(engine.toHtml("\\documentclass[nonumbers]{ieee}\nx")).not.toContain("--num-");
    expect(engine.toHtml("\\documentclass[numbered]{normal}\nx")).toContain("--num-decimal");
    expect(engine.toHtml("\\documentclass[numbered]{ieee}\nx")).toContain("--num-ieee");
    expect(engine.styles("\\documentclass[12pt]{ieee}\nx")).toContain("--retex-fs-base: 12pt");
  });

  it("applyPaperOptions does not modify the theme it is given", () => {
    const before = JSON.stringify(ieeeTheme);
    applyPaperOptions(ieeeTheme, ["onecolumn", "a4paper", "12pt", "nonumbers"]);
    expect(JSON.stringify(ieeeTheme)).toBe(before);
  });

  it("page flags alone leave a resume as a resume", () => {
    const html = engine.toHtml("\\documentclass[a4paper]{modern}\n\\name{A}");
    expect(html).not.toContain("retex-paper");
    expect(html).toContain("retex-name");
  });

  it("documents without a paper style are untouched", () => {
    const html = engine.toHtml("\\name{A}\n\\section{S}\nx");
    expect(html).toMatch(/^<div class="retex-resume">/);
    expect(engine.styles()).not.toContain("retex-paper");
    expect(engine.toHtmlDocument("\\name{A}")).toContain("<title>Resume</title>");
    expect(engine.toHtmlDocument("\\name{A}")).not.toContain("@page");
  });

  it("the front matter sits above the body", () => {
    const html = engine.toHtml(paper);
    expect(html.indexOf("retex-paper-title")).toBeLessThan(html.indexOf("retex-paper-body"));
    expect(html.indexOf("retex-author")).toBeLessThan(html.indexOf("retex-paper-body"));
  });

  it("the abstract goes in the column for IEEE, and above it for the others", () => {
    const place = (style: string): boolean => {
      const html = engine.toHtml(paper.replace("{ieee}", `{${style}}`));
      return html.indexOf("retex-abstract") > html.indexOf("retex-paper-body");
    };
    expect(place("ieee")).toBe(true);
    expect(place("acm")).toBe(false);
    expect(place("normal")).toBe(false);
  });

  it("labels follow the style", () => {
    const ieee = engine.toHtml(paper);
    expect(ieee).toContain(">Index Terms<");
    expect(engine.toHtml(paper.replace("{ieee}", "{acm}"))).toContain(">Keywords<");
  });

  it("links before the first section stay in their sentence", () => {
    const html = engine.toHtml(paper);
    expect(html).toMatch(/<p[^>]*>Lead <a[^>]*>link<\/a> text\.<\/p>/);
  });

  it("\\name is treated as an author", () => {
    expect(engine.toHtml("\\documentclass{ieee}\n\\name{Ada}")).toContain("retex-author-name");
  });

  it("uses the paper's title for the page", () => {
    expect(engine.toHtmlDocument(paper)).toContain("<title>T</title>");
    expect(engine.toHtmlDocument(paper, { title: "Mine" })).toContain("<title>Mine</title>");
    expect(engine.toPrintHtml(paper)).toContain("<title>T</title>");
  });

  it("standalone pages get real page rules, and fragments leave the body alone", () => {
    const page = engine.toHtmlDocument(paper);
    expect(page).toContain("@page");
    expect(page).toContain("size: Letter");
    expect(page).toContain("0.75in 0.625in 1in");
    expect(engine.styles(paper)).not.toContain("html, body");
    expect(engine.styles(paper)).not.toContain("@page");
    expect(engine.toPrintHtml(paper)).toContain("@page");
  });

  it("a standalone paper contains no scripts", () => {
    expect(markdownToHtml(sample, { style: "ieee" })).not.toContain("<script");
  });

  it("numbers use the right scheme per style", () => {
    expect(engine.styles("\\documentclass{ieee}")).toContain("upper-roman");
    expect(engine.toHtml("\\documentclass{apa}\nx")).not.toContain("--num-");
    expect(engine.toHtml("\\section*{S}")).toContain("retex-section--unnumbered");
  });

  it("unsafe theme values cannot reach the stylesheet", () => {
    const e = new ReTeXEngine({
      theme: {
        name: "evil",
        page: { margin: "1in; } body { display: none" },
        paper: {
          columnGap: "1px; } body { display: none",
          lineHeight: "1; } body { display: none",
          variant: 'x"><script>',
          figureLabel: 'Fig"; } body { display:none } a { content:"',
        },
      },
    });
    const css = e.styles();
    expect(css).not.toMatch(/}\s*body\s*{\s*display:\s*none/);
    expect(e.toHtml("x")).not.toContain("<script");
    expect(e.toHtml("x")).toContain('retex-paper--xscript"');
  });

  it("custom paper styles", () => {
    const e = new ReTeXEngine({
      libraries: [
        createPaperStyle({
          ...normalTheme,
          name: "mylab",
          paper: { ...normalTheme.paper, columns: 2, variant: "mylab" },
        }),
      ],
    });
    expect(e.toHtml("\\documentclass{mylab}\nx")).toContain("retex-paper--mylab");
  });
});

describe("equation fit", () => {
  const short = "\\begin{equation}a = b\\end{equation}";
  const long = `\\begin{equation}${"a + b + c + ".repeat(5)}d\\end{equation}`;
  const huge = `\\begin{equation}${"a + b + c + ".repeat(20)}d\\end{equation}`;
  const render = (style: string, body: string): string =>
    engine.toHtml(`\\documentclass{${style}}\n${body}`);

  it("a formula too wide for its column spans the page, only in two columns", () => {
    expect(render("ieee", short)).not.toContain("retex-equation--wide");
    expect(render("ieee", long)).toContain("retex-equation--wide");
    expect(render("arxiv", long)).not.toContain("retex-equation--wide");
  });

  it("a formula too wide for the page shrinks instead of being cut off", () => {
    expect(render("arxiv", long)).not.toContain("font-size");
    expect(render("arxiv", huge)).toMatch(/retex-equation[^"]*" style="font-size:0\.\d+em"/);
  });

  it("ordinary documents are left to scroll", () => {
    expect(engine.toHtml(huge)).not.toContain("font-size");
    expect(engine.toHtml(huge)).not.toContain("--wide");
  });

  it("the stylesheet can never clip the start of a formula", () => {
    expect(engine.styles()).toContain("justify-content: safe center");
  });

  it("the math in the sample's narrow columns stays in its column", () => {
    const html = engine.toHtml(parseMarkdown(sample, { style: "ieee" }).ast);
    expect(html).toContain("retex-equation--numbered");
    expect(html).not.toContain("retex-equation--wide");
  });

  it("code is never hyphenated", () => {
    const css = engine.styles("\\documentclass{ieee}");
    expect(css).toMatch(/-code \{[^}]*hyphens: manual/);
    expect(css).toMatch(/-codeblock \{[^}]*hyphens: manual/);
  });
});

describe("round trip: Markdown to .retex and back", () => {
  const roundTrips: Array<[string, string]> = [
    ["the full sample", sample],
    ["inline markup", "**b** *i* ~~s~~ `c` <sub>x</sub> <sup>y</sup> [l](https://x.org) a  \nb"],
    ["special characters", "100%% {braces} back\\\\slash [brackets] 50% $5 & $6 # _ ~"],
    ["code with hard characters", "`{` `}` `\\` `%%` `\\n` `a{b}c`"],
    ["a code block with hard characters", "```\nif (x) {\n\n  y = \"\\n\"; %% z\n}\n```"],
    ["math with hard characters", "$\\{x\\}$ $[0, 1)$ $a\\,b$ $\\frac{a}{b}$\n\n$$\\{a \\\\ b\\}$$"],
    ["alignment", "\\begin{align}\na &= b \\\\\nc &= d\n\\end{align}"],
    ["nested lists", "- a\n  - b\n    - c\n- d\n\n3. x\n4. y\n   - z"],
    ["loose lists", "- a\n\n  second\n- b"],
    ["a list with code", "- a\n\n  ```py\n  if x:\n      y\n  ```\n- b"],
    ["quotes", "> a\n>\n> > b\n>\n> [c] d\n\n> [starts with bracket]"],
    ["tables", "**Table 1: T**\n\n| a | **b** |\n|:--|--:|\n| [x](https://x.org) | `c` |"],
    ["table with no alignment", "| a | b |\n|---|---|\n| 1 | 2 |"],
    ["figures", '![Alt, text](a.png "Cap")\n\n![x](b.png)\n\nInline ![y](c.png) image'],
    ["footnotes", "a[^1] b[^2]\n\n[^1]: One.\n[^2]: Two *i*."],
    ["references", "a [1] b [1, 2]\n\n## References\n\n[1] A.\n[2] *B*."],
    ["front matter", "---\ntitle: T\nauthors:\n  - name: A\n    affiliation: B, C\n    email: a@b.org\n---\nx"],
    ["rich headings", "# On $O(n)$\n\n## **Bold** and `code`\n\n### Sub\n\n#### Sub sub\n\n##### Para"],
    ["rules", "a\n\n---\n\nb"],
    ["task lists", "- [ ] a\n- [x] b"],
  ];

  for (const style of ["normal", "ieee"]) {
    for (const [name, md] of roundTrips) {
      it(`${name} (${style})`, () => {
        const { ast } = parseMarkdown(md, { style });
        const source = printDocument(ast);
        const compiled = engine.compile(source);
        const errors = compiled.diagnostics.filter(
          (d) => d.severity === DiagnosticSeverity.Error,
        );
        expect(errors, source).toEqual([]);
        // The source compiles to the same page the Markdown did.
        expect(engine.toHtml(compiled.ast)).toBe(engine.toHtml(ast));
        // And printing it again changes nothing.
        expect(printDocument(compiled.ast)).toBe(source);
      });
    }
  }
});

describe("incremental compiler with verbatim bodies", () => {
  it("keeps a code block with blank lines and unbalanced braces in one piece", () => {
    const src =
      "Before.\n\n\\begin{code}\nif (x) {\n\n  \\end{other}\n\n\\end{code}\n\nAfter.";
    const compiler = new IncrementalCompiler();
    const { ast, diagnostics } = compiler.compile(src);
    expect(diagnostics.filter((d) => d.severity === DiagnosticSeverity.Error)).toEqual([]);
    const code = collect(ast, (n) => n.type === "codeblock");
    expect(code).toHaveLength(1);
    expect((code[0] as Extract<Node, { type: "codeblock" }>).value).toContain("\\end{other}");
    const full = new ReTeXEngine();
    expect(full.toHtml(ast)).toBe(full.toHtml(src));
  });

  it("matches a full parse for the whole sample", () => {
    const source = markdownToRetex(sample, { style: "ieee" });
    const { ast } = new IncrementalCompiler().compile(source);
    const full = new ReTeXEngine();
    expect(full.toHtml(ast)).toBe(full.toHtml(source));
  });
});

describe("editor tooling", () => {
  it("formatting a paper does not change what it renders to", () => {
    const source = markdownToRetex(sample, { style: "ieee" });
    const once = printDocument(engine.compile(source).ast);
    expect(engine.toHtml(once)).toBe(engine.toHtml(source));
  });

  it("a source map does not change the content", () => {
    const source = markdownToRetex(sample, { style: "ieee" });
    const mapped = engine.toHtml(source, { sourceMap: true });
    const stripped = mapped.replace(/ data-rtx-(pos|type)="[^"]*"/g, "");
    expect(stripped).toBe(engine.toHtml(source));
    expect(mapped).toContain('data-rtx-type="math"');
    expect(mapped).toContain('data-rtx-type="table"');
  });
});

describe("React renderer parity", () => {
  /** A JSX factory that serializes to markup, so the output can be compared. */
  const FRAGMENT = "fragment";
  const VOID = new Set(["br", "hr", "img"]);
  const escape = (text: string): string =>
    text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  const h = (
    type: unknown,
    props: Record<string, unknown> | null,
    ...children: unknown[]
  ): Markup => {
    const inner = (props?.dangerouslySetInnerHTML as { __html: string } | undefined)?.__html;
    const body =
      inner ??
      children
        .map((c) => (c instanceof Markup ? c.html : escape(String(c))))
        .join("");
    if (type === FRAGMENT) return new Markup(body);
    const attrs = Object.entries(props ?? {})
      .filter(([k]) => k !== "key" && k !== "dangerouslySetInnerHTML" && k !== "style")
      .map(([k, v]) => ` ${k === "className" ? "class" : k}="${escape(String(v))}"`)
      .join("");
    return new Markup(
      VOID.has(type as string) ? `<${type}${attrs}>` : `<${type}${attrs}>${body}</${type}>`,
    );
  };
  class Markup {
    constructor(readonly html: string) {}
  }

  /** What a reader sees: the words and math, ignoring markup and layout whitespace. */
  const visible = (html: string): string =>
    html
      .replace(/<annotation.*?<\/annotation>/g, "")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, "");

  for (const style of ["normal", "ieee", "acm"]) {
    it(`renders the sample like the HTML renderer (${style})`, () => {
      const { ast } = parseMarkdown(sample, { style });
      const e = new ReTeXEngine();
      const react = (
        e.toReact(ast, { createElement: h, Fragment: FRAGMENT }) as Markup
      ).html;
      const html = e.toHtml(ast);
      expect(visible(react)).toBe(visible(html));
      for (const fragment of [
        `retex-paper--${style}`,
        "retex-paper-title",
        "retex-paper-body",
        "retex-author-name",
        "retex-abstract-label",
        "retex-keywords-label",
        "retex-table-wrap",
        "retex-equation--numbered",
        "retex-codeblock",
        "retex-references",
        "retex-footnotes",
        "<math",
        'href="#retex-ref-1"',
      ]) {
        expect(react, fragment).toContain(fragment);
      }
    });
  }
});

describe("convenience functions", () => {
  it("markdownToHtml makes a standalone page", () => {
    const html = markdownToHtml("# My Paper\n\nBody.", { style: "acm" });
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<title>My Paper</title>");
    expect(html).toContain("retex-paper--acm");
    expect(markdownToHtml("x", { pageTitle: "Mine" })).toContain("<title>Mine</title>");
  });

  it("markdownToRetex makes source that compiles cleanly", () => {
    const source = markdownToRetex(sample, { style: "ieee" });
    expect(source).toMatch(/^\\documentclass\{ieee\}/);
    expect(errorsOf(source)).toEqual([]);
    expect(engine.compile(source).diagnostics).toEqual([]);
  });

  it("the sample converts without warnings", () => {
    const { diagnostics } = parseMarkdown(sample, { style: "ieee" });
    expect(diagnostics.filter((d) => d.severity !== DiagnosticSeverity.Info)).toEqual([]);
  });

  it("markdownToPdf goes through the supplied browser with the right geometry", async () => {
    const calls: { html?: string; pdf?: Record<string, unknown> } = {};
    const launch = async (): Promise<HeadlessBrowser> => ({
      newPage: async () => ({
        setContent: async (html: string) => {
          calls.html = html;
        },
        pdf: async (options: Record<string, unknown>) => {
          calls.pdf = options;
          return new Uint8Array([1, 2, 3]);
        },
      }),
      close: async () => {},
    });
    const bytes = await markdownToPdf("# T\n\nx", { style: "ieee", pageSize: "A4", launch });
    expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(calls.html).toContain("retex-paper--ieee");
    expect(calls.pdf).toMatchObject({
      format: "A4",
      preferCSSPageSize: true,
      margin: { top: "0.75in", right: "0.625in", bottom: "1in", left: "0.625in" },
    });
  });
});
