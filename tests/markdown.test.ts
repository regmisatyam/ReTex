import { describe, it, expect } from "vitest";
import {
  ReTeXEngine,
  DiagnosticSeverity,
  collect,
  extractFrontMatter,
  flattenText,
  markdownToHtml,
  markdownToRetex,
  parseMarkdown,
  type MarkdownOptions,
  type Node,
} from "../src/index.js";

const engine = new ReTeXEngine();
const ast = (md: string, options?: MarkdownOptions) => parseMarkdown(md, options).ast;
const html = (md: string, options?: MarkdownOptions): string =>
  engine.toHtml(ast(md, options));
const find = <T extends Node["type"]>(md: string, type: T, options?: MarkdownOptions) =>
  collect(ast(md, options), (n) => n.type === type) as Array<Extract<Node, { type: T }>>;

describe("markdown: inline", () => {
  const cases: Array<[string, string, string]> = [
    ["bold", "**a**", "<strong>a</strong>"],
    ["bold with underscores", "__a__", "<strong>a</strong>"],
    ["italic", "*a*", "<em>a</em>"],
    ["bold italic", "***a***", "<em><strong>a</strong></em>"],
    ["nested", "**a *b* c**", "<strong>a <em>b</em> c</strong>"],
    ["strike", "~~a~~", "<s>a</s>"],
    ["inline code", "`a*b*c`", ">a*b*c</code>"],
    ["double backtick code", "`` a`b ``", ">a`b</code>"],
    ["hard break", "a  \nb", "a<br>b"],
    ["backslash break", "a\\\nb", "a<br>b"],
    ["soft break", "a\nb", "a b"],
    ["escaped star", "\\*a\\*", "*a*"],
    ["entity", "&copy; &#169; &#xA9;", "© © ©"],
    ["sub and sup html", "H<sub>2</sub>O x<sup>2</sup>", "H<sub>2</sub>O x<sup>2</sup>"],
    ["br html", "a<br/>b", "a<br>b"],
  ];
  for (const [name, input, expected] of cases) {
    it(name, () => expect(html(input)).toContain(expected));
  }

  it("leaves text that only looks like emphasis alone", () => {
    expect(html("snake_case_name stays")).toContain("snake_case_name stays");
    expect(html("2 * 3 * 4")).toContain("2 * 3 * 4");
    expect(html("about ~5% or ~10%")).toContain("about ~5% or ~10%");
    expect(html("a*")).toContain("a*");
  });

  it("keeps angle brackets that are not tags", () => {
    expect(html("if a < b and c > d")).toContain("if a &lt; b and c &gt; d");
    expect(html("a List<String> value")).toContain("List&lt;String&gt;");
    expect(html("x<y and z>w")).toContain("x&lt;y and z&gt;w");
  });

  it("links, reference links, and autolinks", () => {
    expect(html("[a](https://x.org)")).toContain('href="https://x.org"');
    expect(html("[a](https://x.org/a_(b))")).toContain('href="https://x.org/a_(b)"');
    expect(html('[a](https://x.org "Title")')).toContain('href="https://x.org"');
    expect(html("[a][r]\n\n[r]: https://x.org")).toContain('href="https://x.org"');
    expect(html("[r]\n\n[R]: https://x.org")).toContain('href="https://x.org"');
    expect(html("<https://x.org>")).toContain('href="https://x.org"');
    expect(html("<a@b.org>")).toContain('href="mailto:a@b.org"');
  });

  it("bare URLs leave sentence punctuation outside the link", () => {
    expect(html("See https://x.org.")).toContain('href="https://x.org"');
    expect(html("(see https://x.org)")).toContain('href="https://x.org"');
    expect(html("https://x.org/a_(b)")).toContain('href="https://x.org/a_(b)"');
  });

  it("does not linkify a URL inside a word", () => {
    expect(find("xhttps://x.org", "url")).toHaveLength(0);
  });
});

describe("markdown: math", () => {
  const tex = (md: string): string[] => find(md, "math").map((n) => n.tex);

  it("recognises every common delimiter", () => {
    expect(tex("a $x^2$ b")).toEqual(["x^2"]);
    expect(tex("a \\(x^2\\) b")).toEqual(["x^2"]);
    expect(tex("a \\[x^2\\] b")).toEqual(["x^2"]);
  });

  it("display math forms become block equations", () => {
    for (const md of [
      "$$x^2$$",
      "$$\nx^2\n$$",
      "\\[x^2\\]",
      "\\[\nx^2\n\\]",
      "```math\nx^2\n```",
      "\\begin{equation}\nx^2\n\\end{equation}",
    ]) {
      const [node] = find(md, "math");
      expect(node, md).toMatchObject({ tex: "x^2", display: true });
    }
  });

  it("keeps alignment environments, which give & and \\\\ their meaning", () => {
    const [node] = find("\\begin{align}\na &= b \\\\\nc &= d\n\\end{align}", "math");
    expect(node!.display).toBe(true);
    expect(node!.tex).toContain("\\begin{align}");
  });

  it("does not mistake prices for math", () => {
    for (const md of [
      "costs $5 and $10",
      "$5, $10, and $15",
      "from $5-$10",
      "US$100 and US$200",
      "price: $ 5 and $ 6",
    ]) {
      expect(tex(md), md).toEqual([]);
    }
  });

  it("an escaped dollar stays literal", () => {
    expect(tex("\\$x\\$")).toEqual([]);
    expect(html("\\$x\\$")).toContain("$x$");
  });

  it("code spans win over math", () => {
    expect(tex("`$x$`")).toEqual([]);
  });

  it("math wins over emphasis and escapes inside the formula", () => {
    expect(tex("$a_1 * b_2 * c_3$")).toEqual(["a_1 * b_2 * c_3"]);
    expect(tex("$\\{x\\}$")).toEqual(["\\{x\\}"]);
  });

  it("an unterminated display formula at the end of an answer is still kept", () => {
    expect(tex("$$\nx^2")).toEqual(["x^2"]);
  });

  it("a formula with unbalanced braces falls back to something printable", () => {
    expect(() => markdownToRetex("$$a{b$$")).not.toThrow();
    expect(tex("$$a{b$$")).toEqual([]);
    expect(find("$$a{b$$", "codeblock")).toHaveLength(1);
  });
});

describe("markdown: blocks", () => {
  it("fenced code, with its language and exact text", () => {
    const [code] = find("```python\nif x:\n    y = {1}\n```", "codeblock");
    expect(code).toMatchObject({ language: "python", value: "if x:\n    y = {1}" });
  });

  it("an unterminated fence runs to the end of the answer", () => {
    expect(find("```js\nlet a;", "codeblock")[0]!.value).toBe("let a;");
  });

  it("indented code", () => {
    expect(find("para\n\n    a = 1\n    b = 2", "codeblock")[0]!.value).toBe("a = 1\nb = 2");
  });

  it("markdown syntax inside a code block stays literal", () => {
    const [code] = find("```\n# not a heading\n**not bold**\n```", "codeblock");
    expect(code!.value).toBe("# not a heading\n**not bold**");
    expect(find("```\n# not a heading\n```", "section")).toHaveLength(0);
  });

  it("block quotes, with lazy continuation and nesting", () => {
    expect(html("> a\nb")).toMatch(/<blockquote[^>]*>.*a b.*<\/blockquote>/s);
    const quotes = find("> a\n>\n> > b", "quote");
    expect(quotes).toHaveLength(2);
  });

  it("GitHub callouts read as a plain label", () => {
    expect(html("> [!NOTE]\n> Careful.")).toContain("<strong>Note.</strong>");
  });

  it("horizontal rules, except the ones AI puts before a heading", () => {
    expect(find("a\n\n---\n\nb", "rule")).toHaveLength(1);
    expect(find("a\n\n---\n\n## B\n\nc", "rule")).toHaveLength(0);
    expect(find("---\n\nb", "rule")).toHaveLength(0);
    expect(find("a\n\n---", "rule")).toHaveLength(0);
  });

  it("--- under a short line is a heading, under a long paragraph a rule", () => {
    expect(find("# T\n\n## A\n\nShort\n---\n\nmore", "section").map((s) => s.title)).toContain(
      "Short",
    );
    const long = "word ".repeat(40).trim();
    expect(find(`${long}\n---\n\nmore`, "section")).toHaveLength(0);
    expect(find(`${long}\n---\n\nmore`, "rule")).toHaveLength(1);
  });

  it("setext headings", () => {
    expect(find("# T\n\nFirst\n=====\n\nSecond\n-----\n\nx", "section")).toHaveLength(2);
  });
});

describe("markdown: lists", () => {
  it("bullets and numbers", () => {
    expect(find("- a\n- b", "list")[0]).toMatchObject({ kind: "itemize" });
    expect(find("1. a\n2. b", "list")[0]).toMatchObject({ kind: "enumerate" });
    expect(find("1) a\n2) b", "list")[0]!.items).toHaveLength(2);
  });

  it("keeps a list's starting number", () => {
    expect(find("3. a\n4. b", "list")[0]!.start).toBe(3);
    expect(html("3. a")).toContain('start="3"');
    expect(find("1. a", "list")[0]!.start).toBeUndefined();
  });

  it("nests sublists, including ones indented less than the marker width", () => {
    for (const md of ["- a\n  - b\n- c", "1. a\n   - b\n2. c", "1. a\n  - b\n2. c"]) {
      const lists = find(md, "list");
      expect(lists, md).toHaveLength(2);
      expect(lists[0]!.items, md).toHaveLength(2);
    }
  });

  it("deep nesting stays deep", () => {
    expect(find("- a\n  - b\n    - c\n      - d", "list")).toHaveLength(4);
  });

  it("a tight item stays bare and a loose one gets paragraphs", () => {
    expect(html("- a\n- b")).toContain("<li>a</li>");
    expect(html("- a\n\n  second\n- b")).toMatch(/<li><p[^>]*>a<\/p>/);
  });

  it("a sublist does not make its parent item loose", () => {
    expect(html("- a\n  - b")).toMatch(/<li>a<ul/);
  });

  it("task lists", () => {
    const out = html("- [ ] todo\n- [x] done");
    expect(out).toContain("☐ todo");
    expect(out).toContain("☑ done");
  });

  it("code in an item keeps its indentation", () => {
    const [code] = find("- a\n\n  ```py\n  if x:\n      y\n  ```", "codeblock");
    expect(code!.value).toBe("if x:\n    y");
  });

  it("prose starting with a number does not interrupt a paragraph", () => {
    expect(find("The total was\n2. That is all.", "list")).toHaveLength(0);
  });

  it("a list can follow a paragraph directly", () => {
    expect(find("Steps:\n1. a\n2. b", "list")).toHaveLength(1);
    expect(find("Items:\n- a", "list")).toHaveLength(1);
  });

  it("a rule is not mistaken for a list", () => {
    expect(find("a\n\n* * *\n\nb", "list")).toHaveLength(0);
    expect(find("a\n\n* * *\n\nb", "rule")).toHaveLength(1);
  });
});

describe("markdown: tables", () => {
  const md = "| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |";

  it("rows and alignment", () => {
    const [table] = find(md, "table");
    expect(table!.align).toEqual(["left", "center", "right"]);
    expect(table!.rows).toHaveLength(2);
    expect(table!.rows[0]!.header).toBe(true);
    const out = html(md);
    expect(out).toContain("<th>a</th>");
    expect(out).toContain('<td style="text-align:right">3</td>');
  });

  it("pipes inside code, math, and escapes do not split cells", () => {
    const cells = (row: string): string[] =>
      find(`| a | b |\n|---|---|\n${row}`, "table")[0]!.rows[1]!.cells.map((c) =>
        flattenText(c.children),
      );
    expect(cells("| `x|y` | z |")).toEqual(["x|y", "z"]);
    expect(cells("| $|x|$ | z |")).toEqual(["|x|", "z"]);
    expect(cells("| x\\|y | z |")).toEqual(["x|y", "z"]);
  });

  it("prices in cells still split on their pipe", () => {
    const [table] = find("| a | b |\n|---|---|\n| $5 | $10 |", "table");
    expect(table!.rows[1]!.cells.map((c) => flattenText(c.children))).toEqual(["$5", "$10"]);
  });

  it("short rows are padded and long ones trimmed", () => {
    const [table] = find("| a | b |\n|---|---|\n| 1 |\n| 1 | 2 | 3 |", "table");
    expect(table!.rows[1]!.cells).toHaveLength(2);
    expect(table!.rows[2]!.cells).toHaveLength(2);
  });

  it("inline markup works in cells", () => {
    expect(html("| a |\n|---|\n| **b** |")).toContain("<td><strong>b</strong></td>");
  });

  it("takes a caption from the paragraph before or after, without its label", () => {
    const t = (src: string): string =>
      flattenText(find(src, "table")[0]!.caption!.children);
    const table = "| a |\n|---|\n| 1 |";
    expect(t(`**Table 1: Results.**\n\n${table}`)).toBe("Results.");
    expect(t(`*Table 2. Results*\n\n${table}`)).toBe("Results");
    expect(t(`${table}\n\nTable III: Results`)).toBe("Results");
    expect(t(`**Table 1:** Results\n\n${table}`)).toBe("Results");
  });

  it("the caption paragraph is not repeated as body text", () => {
    const out = html("Table 1: Results\n\n| a |\n|---|\n| 1 |\n\nAfter.");
    expect(out.match(/Results/g)).toHaveLength(1);
    expect(out).toContain("After.");
  });

  it("a paragraph that merely mentions a table stays where it is", () => {
    const src = "Table 1 shows the results clearly.\n\n| a |\n|---|\n| 1 |";
    expect(html(src)).toContain("Table 1 shows");
    expect(find(src, "table")[0]!.caption).toBeUndefined();
  });

  it("wide tables span the page only in two-column styles", () => {
    const wide = "| a | b | c | d | e |\n|---|---|---|---|---|\n| 1 | 2 | 3 | 4 | 5 |";
    expect(find(wide, "table", { style: "ieee" })[0]!.wide).toBe(true);
    expect(find(wide, "table", { style: "arxiv" })[0]!.wide).toBeUndefined();
    expect(find(md, "table", { style: "ieee" })[0]!.wide).toBeUndefined();
    const long = `| a | b |\n|---|---|\n| ${"x".repeat(50)} | ${"y".repeat(20)} |`;
    expect(find(long, "table", { style: "ieee" })[0]!.wide).toBe(true);
  });

  it("the delimiter row must match the header", () => {
    expect(find("| a | b |\n|---|\n| 1 | 2 |", "table")).toHaveLength(0);
  });
});

describe("markdown: figures", () => {
  it("an image alone in a paragraph becomes a figure captioned by its title", () => {
    const [figure] = find('![alt](a.png "The title")', "figure");
    expect(figure).toBeDefined();
    const out = html('![alt](a.png "The title")');
    expect(out).toContain('src="a.png"');
    expect(out).toContain('alt="alt"');
    expect(out).toContain(">The title</figcaption>");
    expect(out).not.toContain('title="');
  });

  it("uses the alt text as a caption unless it is a placeholder", () => {
    expect(html("![A diagram of the system](a.png)")).toContain(
      ">A diagram of the system</figcaption>",
    );
    expect(html("![image](a.png)")).not.toContain("figcaption");
    expect(html("![Figure 2](a.png)")).not.toContain("figcaption");
  });

  it("takes a caption from a following Figure line, without its label", () => {
    const out = html("![x](a.png)\n\n*Figure 1: Overview of the system.*\n\nNext.");
    expect(out).toContain(">Overview of the system.</figcaption>");
    expect(out.match(/Overview/g)).toHaveLength(1);
    expect(out).toContain("Next.");
  });

  it("an image in running text stays inline", () => {
    expect(find("See ![x](a.png) here", "figure")).toHaveLength(0);
    expect(find("See ![x](a.png) here", "image")).toHaveLength(1);
  });

  it("an HTML image also works", () => {
    const [image] = find('<img src="a.png" alt="x" width="200">', "image");
    expect(image).toMatchObject({ src: "a.png", alt: "x", width: "200px" });
  });
});

describe("markdown: paper structure", () => {
  const titleOf = (md: string, options?: MarkdownOptions): string | undefined =>
    collect(ast(md, options), (n) => n.type === "contact" && n.field === "title").map(
      (n) => (n as Extract<Node, { type: "contact" }>).value,
    )[0];
  const titles = (md: string, options?: MarkdownOptions): Array<[string, number]> =>
    find(md, "section", options).map((s) => [s.title, s.level]);

  it("a lone first heading is the title, and the next level becomes sections", () => {
    const md = "# Paper\n\n## A\n\n### B\n\n## C";
    expect(titleOf(md)).toBe("Paper");
    expect(titles(md)).toEqual([
      ["A", 1],
      ["B", 2],
      ["C", 1],
    ]);
  });

  it("a first H1 starting a series of H1s is still the title", () => {
    const md = "# Paper\n\n# Intro\n\n# End";
    expect(titleOf(md)).toBe("Paper");
    expect(titles(md).map(([t]) => t)).toEqual(["Intro", "End"]);
  });

  it("no invented title when the first heading is plainly a section", () => {
    const md = "# Introduction\n\ntext\n\n# Methods\n\ntext";
    expect(titleOf(md)).toBeUndefined();
    expect(titles(md).map(([t]) => t)).toEqual(["Introduction", "Methods"]);
  });

  it("works when a document never uses H1", () => {
    const md = "## Paper\n\n### A\n\n### B";
    expect(titleOf(md)).toBe("Paper");
    expect(titles(md)).toEqual([
      ["A", 1],
      ["B", 1],
    ]);
  });

  it("no title when the document has no headings", () => {
    expect(titleOf("just text")).toBeUndefined();
  });

  it("levels are ranked, so skipped levels leave no gaps", () => {
    expect(titles("# T\n\n## A\n\n#### B\n\n###### C")).toEqual([
      ["A", 1],
      ["B", 2],
      ["C", 3],
    ]);
  });

  it("heading markup stays, except emphasis around the whole heading", () => {
    expect(find("# T\n\n## **Bold**", "section")[0]).toMatchObject({ title: "Bold" });
    expect(find("# T\n\n## **Bold**", "section")[0]!.children).toBeUndefined();
    const [section] = find("# T\n\n## On $O(n)$ time", "section");
    expect(section!.title).toBe("On O(n) time");
    expect(html("# T\n\n## On $O(n)$ time")).toContain("<math");
  });

  it("math in the title renders as math", () => {
    expect(html("# On $O(n)$ sorting\n\n## A")).toMatch(/retex-paper-title[^>]*>.*<math/);
  });

  describe("numbering in headings", () => {
    const names = (md: string, style: string): string[] =>
      find(md, "section", { style }).map((s) => s.title);

    it("removes hand-written numbers when the style numbers sections itself", () => {
      for (const heading of ["1. Intro", "1) Intro", "1: Intro", "1.1 Intro", "1.1. Intro"]) {
        expect(names(`# T\n\n## ${heading}\n\n## 2. Next`, "ieee")[0], heading).toBe("Intro");
      }
    });

    it("keeps them in a style that does not number, like normal", () => {
      expect(names("# T\n\n## 1. Intro\n\n## 2. Next", "normal")).toEqual([
        "1. Intro",
        "2. Next",
      ]);
    });

    it("also removes them from inside bold", () => {
      expect(names("# T\n\n## **1. Intro**\n\n## B", "ieee")[0]).toBe("Intro");
    });

    it("handles roman and letter numbers only when used consistently", () => {
      expect(names("# T\n\n## I. Intro\n\n## II. Next", "ieee")).toEqual(["Intro", "Next"]);
      expect(names("# T\n\n## C. elegans genome\n\n## Results", "ieee")[0]).toBe(
        "C. elegans genome",
      );
    });

    it("leaves a bare number alone unless every heading has one", () => {
      expect(names("# T\n\n## 3 Body Problem\n\n## Results", "ieee")[0]).toBe("3 Body Problem");
      expect(names("# T\n\n## 1 Intro\n\n## 2 Next", "ieee")).toEqual(["Intro", "Next"]);
    });

    it("a year-like or decimal title is not touched", () => {
      expect(names("# T\n\n## 2024 in Review\n\n## Results", "ieee")[0]).toBe("2024 in Review");
      expect(names("# T\n\n## 5G Networks\n\n## Results", "ieee")[0]).toBe("5G Networks");
    });
  });

  describe("metadata lines", () => {
    const authors = (md: string) => find(md, "author").map((a) => a.fields);

    it("authors, with affiliations in parentheses", () => {
      expect(authors("# T\n\n**Authors:** Ada Lovelace (Lab A), Alan Turing and Ann Lee")).toEqual([
        { name: "Ada Lovelace", affiliation: "Lab A" },
        { name: "Alan Turing" },
        { name: "Ann Lee" },
      ]);
    });

    it("a shared affiliation and email, on separate lines", () => {
      expect(
        authors("# T\n\n**Author:** Ada Lovelace  \n**Affiliation:** MIT  \n**Email:** a@b.org"),
      ).toEqual([{ name: "Ada Lovelace", affiliation: "MIT", email: "a@b.org" }]);
    });

    it("an affiliation line given before the authors still applies", () => {
      expect(authors("# T\n\n**Affiliation:** MIT\n**Authors:** Ada, Alan")).toEqual([
        { affiliation: "MIT", name: "Ada" },
        { affiliation: "MIT", name: "Alan" },
      ]);
    });

    it("the date, and other text in the same paragraph is kept", () => {
      const md = "# T\n\n**Date:** Jan 2026\nThis is the lead-in.";
      expect(find(md, "contact").map((c) => [c.field, c.value])).toContainEqual([
        "date",
        "Jan 2026",
      ]);
      expect(html(md)).toContain("This is the lead-in.");
    });

    it("a title given as a label", () => {
      expect(titleOf("**Title:** My Paper\n\nText")).toBe("My Paper");
    });

    it("ordinary sentences that start with those words are left alone", () => {
      for (const line of [
        "Authors of novels often write alone.",
        "Date palms grow in deserts.",
        "Abstract art is hard to define.",
        "Title insurance protects buyers.",
        "Keywords matter in search.",
      ]) {
        const out = html(`# T\n\n${line}`);
        expect(out, line).toContain(line);
        expect(find(`# T\n\n${line}`, "abstract"), line).toHaveLength(0);
        expect(find(`# T\n\n${line}`, "keywords"), line).toHaveLength(0);
        expect(find(`# T\n\n${line}`, "author"), line).toHaveLength(0);
      }
    });

    it("metadata is only read before the first section", () => {
      const md = "# T\n\n## A\n\n**Date:** yesterday\n\n**Keywords:** none";
      expect(find(md, "keywords")).toHaveLength(0);
      expect(html(md)).toContain("yesterday");
    });
  });

  describe("abstract and keywords", () => {
    const abstractText = (md: string): string =>
      flattenText(find(md, "abstract")[0]?.children ?? []);

    it("as headings of any level", () => {
      for (const heading of ["## Abstract", "### Abstract", "## ABSTRACT", "## **Abstract**"]) {
        expect(abstractText(`# T\n\n${heading}\n\nWe show.\n\n## Intro`), heading).toBe("We show.");
      }
    });

    it("as run-in labels", () => {
      for (const line of [
        "**Abstract:** We show.",
        "**Abstract** We show.",
        "**Abstract.** We show.",
        "*Abstract:* We show.",
        "Abstract: We show.",
        "__Abstract__: We show.",
      ]) {
        expect(abstractText(`# T\n\n${line}\n\n## Intro`), line).toBe("We show.");
      }
    });

    it("keeps several paragraphs, and stops at the next heading", () => {
      const md = "# T\n\n## Abstract\n\nOne.\n\nTwo.\n\n## Intro\n\nThree.";
      const [node] = find(md, "abstract");
      expect(flattenText(node!.children)).toContain("One.");
      expect(flattenText(node!.children)).toContain("Two.");
      expect(flattenText(node!.children)).not.toContain("Three.");
      expect(find(md, "section").map((s) => s.title)).toEqual(["Intro"]);
    });

    it("keywords, as a label, a heading, or a list", () => {
      const items = (md: string): string[] => find(md, "keywords")[0]?.items ?? [];
      const expected = ["a", "b", "c"];
      expect(items("# T\n\n**Keywords:** a, b, c\n\n## I")).toEqual(expected);
      expect(items("# T\n\n**Keywords: a, b, c**\n\n## I")).toEqual(expected);
      expect(items("# T\n\n*Keywords:* a; b; c.\n\n## I")).toEqual(expected);
      expect(items("# T\n\nIndex Terms: a, b, c\n\n## I")).toEqual(expected);
      expect(items("# T\n\n## Keywords\n\na, b, c\n\n## I")).toEqual(expected);
      expect(items("# T\n\n## Keywords\n\n- a\n- b\n- c\n\n## I")).toEqual(expected);
      expect(items("# T\n\n## Abstract\n\nX.\n\n**Keywords:** a, b, c\n\n## I")).toEqual(expected);
    });
  });

  describe("references and citations", () => {
    const keys = (md: string): string[] =>
      find(md, "bibitem").map((b) => b.key);
    const refs = "\n\n## References\n\n[1] First.\n[2] Second.\n[3] Third.";

    it("recognises the common ways to write a reference list", () => {
      const lists = [
        "[1] First.\n[2] Second.",
        "[1] First.\n\n[2] Second.",
        "1. First.\n2. Second.",
        "- First.\n- Second.",
      ];
      for (const list of lists) {
        expect(keys(`# T\n\n## References\n\n${list}`), list).toEqual(["1", "2"]);
      }
      for (const name of ["Bibliography", "Works Cited", "Sources", "REFERENCES", "**References**"]) {
        expect(keys(`# T\n\n## ${name}\n\n1. First.`), name).toEqual(["1"]);
      }
    });

    it("the section is unnumbered, and comes out as a bibliography", () => {
      const [section] = find(`# T\n\n## A${refs}`, "section").filter(
        (s) => s.title === "References",
      );
      expect(section!.unnumbered).toBe(true);
      expect(html(`# T\n\n## A${refs}`)).toContain('id="retex-ref-3"');
    });

    it("a numbered reference heading loses its number", () => {
      const md = "# T\n\n## 1. Intro\n\n## 2. References\n\n1. First.";
      expect(find(md, "section", { style: "ieee" }).map((s) => s.title)).toEqual([
        "Intro",
        "References",
      ]);
      expect(find(md, "bibitem", { style: "ieee" })).toHaveLength(1);
    });

    it("links [1], [1, 2], and [1-3] in the text to their entries", () => {
      expect(find(`a [1] b${refs}`, "cite")[0]!.keys).toEqual(["1"]);
      expect(find(`a [1, 2] b${refs}`, "cite")[0]!.keys).toEqual(["1", "2"]);
      expect(find(`a [1; 2] b${refs}`, "cite")[0]!.keys).toEqual(["1", "2"]);
      expect(find(`a [1-3] b${refs}`, "cite")[0]!.keys).toEqual(["1", "2", "3"]);
      expect(find(`a [1–3] b${refs}`, "cite")[0]!.keys).toEqual(["1", "2", "3"]);
      expect(html(`a [2] b${refs}`)).toContain('<a href="#retex-ref-2">2</a>');
    });

    it("named keys work too", () => {
      const md = "a [@smith] b\n\n## References\n\n[@smith] Smith, 2020.";
      expect(find(md, "cite")[0]!.keys).toEqual(["smith"]);
    });

    it("leaves brackets alone when they are not citations", () => {
      for (const md of [
        `arr[1] is first${refs}`,
        `see [9] unknown${refs}`,
        `[1](https://x.org) is a link${refs}`,
        `a [1, 9] partly unknown${refs}`,
      ]) {
        expect(find(md, "cite"), md).toHaveLength(0);
      }
      expect(find("a [1] b", "cite")).toHaveLength(0);
      expect(html("a [1] b")).toContain("a [1] b");
    });

    it("citations also resolve in tables, captions, and the abstract", () => {
      expect(find(`| a |\n|---|\n| [1] |${refs}`, "cite")).toHaveLength(1);
      expect(find(`# T\n\n## Abstract\n\nSee [1].\n\n## A${refs}`, "cite")).toHaveLength(1);
    });

    it("duplicate keys are renumbered instead of colliding", () => {
      const k = keys("# T\n\n## References\n\n[1] A.\n[1] B.");
      expect(new Set(k).size).toBe(2);
    });

    it("an empty references section does not break anything", () => {
      expect(() => html("# T\n\n## References")).not.toThrow();
    });
  });

  describe("footnotes", () => {
    it("collects them at the end, in order of use", () => {
      const out = html("a[^x] b[^y]\n\n[^y]: Why.\n[^x]: Ex.");
      expect(out.indexOf("Ex.")).toBeLessThan(out.indexOf("Why."));
      expect(out).toContain('href="#retex-fn-1"');
      expect(out).toContain('id="retex-fn-2"');
    });

    it("a missing definition stays as text", () => {
      expect(find("a[^x] b", "footnote")).toHaveLength(0);
      expect(html("a[^x] b")).toContain("[^x]");
    });

    it("long footnotes with several paragraphs", () => {
      const out = html("a[^x]\n\n[^x]: One.\n\n    Two.\n\nAfter.");
      expect(out).toContain("One.");
      expect(out).toContain("Two.");
      expect(out.indexOf("After.")).toBeLessThan(out.indexOf("One."));
    });

    it("a note that cites itself does not recurse forever", () => {
      expect(() => html("a[^x]\n\n[^x]: See[^x]")).not.toThrow();
    });

    it("the definition itself is not body text", () => {
      expect(html("a\n\n[^x]: Unused note.")).not.toContain("Unused note.");
    });
  });
});

describe("markdown: front matter", () => {
  it("reads the common keys", () => {
    const { ast: doc, style } = parseMarkdown(
      `---
title: "My Paper"
author: Ada Lovelace
date: 2026-01-01
keywords: [a, b]
style: ieee
columns: 1
paper: a4
---
Body text.`,
    );
    expect(style).toBe("ieee");
    const out = engine.toHtml(doc);
    expect(out).toContain(">My Paper</h1>");
    expect(out).toContain("Ada Lovelace");
    expect(out).toContain("Body text.");
    expect(out).not.toContain("2col");
    expect(engine.toHtmlDocument(doc)).toContain("size: A4");
  });

  it("lists of authors, with their details", () => {
    const authors = (src: string) =>
      collect(ast(src), (n) => n.type === "author").map(
        (a) => (a as Extract<Node, { type: "author" }>).fields,
      );
    expect(
      authors(`---
authors:
  - name: Ada
    affiliation: Lab
  - name: Alan
---
x`),
    ).toEqual([{ name: "Ada", affiliation: "Lab" }, { name: "Alan" }]);
    expect(authors("---\nauthors:\n  - Ada\n  - Alan\n---\nx")).toEqual([
      { name: "Ada" },
      { name: "Alan" },
    ]);
  });

  it("text blocks", () => {
    const { data } = extractFrontMatter("---\nabstract: |\n  One.\n  Two.\n---\nx");
    expect(data.abstract).toBe("One.\nTwo.");
    expect(extractFrontMatter("---\nabstract: >\n  One.\n  Two.\n---\nx").data.abstract).toBe(
      "One. Two.",
    );
  });

  it("does not repeat a title also given as the first heading", () => {
    const out = html("---\ntitle: My Paper\n---\n# My Paper\n\n## A");
    expect(out.match(/My Paper/g)).toHaveLength(1);
  });

  it("a leading rule is just a rule", () => {
    const { body, data } = extractFrontMatter("---\n\nNot: front matter here\n\nx y z\n---\nb");
    expect(data).toEqual({});
    expect(body).toContain("---");
    expect(extractFrontMatter("---\nno close").data).toEqual({});
  });

  it("options override the document", () => {
    const md = "---\ntitle: A\nstyle: ieee\n---\nx";
    expect(parseMarkdown(md, { style: "acm" }).style).toBe("acm");
    expect(html(md, { title: "B" })).toContain(">B</h1>");
  });
});

describe("markdown: AI cleanup", () => {
  const removed = (md: string, options?: MarkdownOptions): string[] =>
    parseMarkdown(md, options).diagnostics.map((d) => d.message);

  it("removes opening and closing chatter, and says so", () => {
    for (const opener of [
      "Sure! Here's your paper:",
      "Certainly! Below is a summary.",
      "Of course, here you go.",
      "Here's the paper you asked for:",
      "Here is a draft.",
      "I've written a draft below.",
      "Great, let's get started.",
    ]) {
      const md = `${opener}\n\n# Title\n\nBody.`;
      expect(html(md), opener).not.toContain(opener.slice(0, 6));
      expect(removed(md).some((m) => m.includes("opening chatter")), opener).toBe(true);
    }
    for (const closer of [
      "Let me know if you'd like changes!",
      "Feel free to ask for more detail.",
      "If you'd like, I can expand this.",
      "Would you like me to add more?",
      "I hope this helps!",
      "*Let me know if you want more.*",
    ]) {
      const md = `# Title\n\nBody.\n\n${closer}`;
      expect(html(md), closer).not.toContain(closer.slice(1, 8));
      expect(removed(md).some((m) => m.includes("closing chatter")), closer).toBe(true);
    }
  });

  it("the removed text is reported as information, not as a problem", () => {
    const { diagnostics } = parseMarkdown("Sure! Here you go:\n\n# T\n\nBody.");
    expect(diagnostics[0]!.severity).toBe(DiagnosticSeverity.Info);
    expect(diagnostics[0]!.message).toContain("Sure! Here you go:");
  });

  it("never removes real content that happens to start similarly", () => {
    for (const para of [
      "Great apes share a common ancestor with humans.",
      "Sure footing matters on steep terrain.",
      "Here we present a new method for sparse attention.\nIt works well.",
      "Certainly the most striking result was the speedup.",
      "Okay is a word with disputed origins.",
    ]) {
      expect(html(`${para}\n\n## Next\n\nBody.`), para).toContain(para.split("\n")[0]);
    }
    for (const para of [
      "Let us now consider the second case.",
      "If you like coffee, this study is for you.",
      "Would be researchers should read this.",
      "Do you want to reduce costs in this way.",
      "Happy to report, the results held up.",
      "Hope remains that this will scale.",
    ]) {
      expect(html(`# T\n\nBody.\n\n${para}`), para).toContain(para);
    }
  });

  it("does not touch a document that is only one paragraph", () => {
    expect(html("Sure! Here you go.")).toContain("Sure! Here you go.");
    expect(html("Let me know what you think.")).toContain("Let me know");
  });

  it("only looks at the very first and very last blocks", () => {
    const md = "# T\n\nFirst.\n\nHere is a list:\n\n- a\n\nLast.";
    expect(html(md)).toContain("Here is a list:");
  });

  it("strips citation markers left in the text", () => {
    const out = html(
      "Claim one【4:0†source】 and two:contentReference[oaicite:1]{index=1} and [cite_start]three[cite: 12, 13].",
    );
    expect(out).toContain("Claim one and two and three.");
  });

  it("strips emoji from the start of headings", () => {
    expect(find("# 🚀 Title\n\n## 🔬 Methods ✅", "section")[0]!.title).toBe("Methods ✅");
    expect(html("# 🚀 Title\n\n## A")).toContain(">Title</h1>");
  });

  it("unwraps an answer fenced as markdown", () => {
    const md = "Here's the document:\n\n```markdown\n# Title\n\n## A\n\nBody.\n```";
    const out = html(md);
    expect(out).toContain(">Title</h1>");
    expect(out).not.toContain("<pre");
  });

  it("does not unwrap when the fence is one part of a longer answer", () => {
    const md = "# How to write Markdown\n\nExample:\n\n```markdown\n# Title\n```\n\nThat is it.";
    expect(find(md, "codeblock")).toHaveLength(1);
  });

  it("stripChatter: false keeps everything", () => {
    const md = "Sure! Here you go:\n\n# 🚀 Title\n\nBody【1†s】.\n\nLet me know!";
    const out = html(md, { stripChatter: false });
    expect(out).toContain("Sure! Here you go:");
    expect(out).toContain("🚀");
    expect(out).toContain("【1†s】");
    expect(out).toContain("Let me know!");
  });
});

describe("markdown: styles", () => {
  it("defaults to the normal style", () => {
    expect(parseMarkdown("x").style).toBe("normal");
    expect(html("x")).toContain("retex-paper--normal");
  });

  it("an unknown style warns and falls back", () => {
    const { style, diagnostics } = parseMarkdown("x", { style: "nope" });
    expect(style).toBe("normal");
    expect(diagnostics.some((d) => d.severity === DiagnosticSeverity.Warning)).toBe(true);
  });

  it("a theme pack that is not a paper style is not accepted", () => {
    expect(parseMarkdown("x", { style: "modern" }).style).toBe("normal");
  });

  it("is case-insensitive", () => {
    expect(parseMarkdown("x", { style: "IEEE" }).style).toBe("ieee");
  });

  it("the choice is recorded in the document, so it survives printing", () => {
    expect(markdownToRetex("x", { style: "ieee" })).toMatch(/^\\documentclass\{ieee\}/);
    expect(markdownToRetex("x", { style: "ieee", columns: 1, pageSize: "A4" })).toMatch(
      /^\\documentclass\[onecolumn, a4paper\]\{ieee\}/,
    );
  });

  it("a custom style from the engine", () => {
    const custom = new ReTeXEngine();
    custom.provideLibrary({
      name: "lab",
      theme: { name: "lab", paper: { variant: "lab", columns: 2 } },
    });
    const { ast: doc, style } = custom.fromMarkdown("x", { style: "lab" });
    expect(style).toBe("lab");
    expect(custom.toHtml(doc)).toContain("retex-paper--lab");
    expect(custom.toHtml(doc)).toContain("retex-paper--2col");
  });
});

describe("markdown: robustness", () => {
  it("handles empty and odd input", () => {
    for (const md of ["", "   ", "\n\n\n", "#", "##", "- ", "> ", "```", "|", "---", "[", "![", "`", "$", "$$", "\\", "<", "&"]) {
      expect(() => markdownToHtml(md), JSON.stringify(md)).not.toThrow();
    }
    expect(() => parseMarkdown(undefined as unknown as string)).not.toThrow();
  });

  it("handles Windows line endings and a BOM", () => {
    expect(html("\ufeff# T\r\n\r\n## A\r\n\r\n- x\r\n- y\r\n")).toContain("<li>y</li>");
  });

  it("survives pathological nesting", () => {
    expect(() => html(">".repeat(5000) + " x")).not.toThrow();
    expect(() => html("[".repeat(5000))).not.toThrow();
    expect(() => html("*".repeat(5000))).not.toThrow();
    expect(() => html("*a ".repeat(5000))).not.toThrow();
    expect(() => html("`".repeat(5000))).not.toThrow();
    expect(() => html("$".repeat(5000))).not.toThrow();
    expect(() =>
      html(Array.from({ length: 300 }, (_, i) => `${" ".repeat(i * 2)}- x`).join("\n")),
    ).not.toThrow();
  });

  it("stays fast on inputs built to cause backtracking", () => {
    const inputs = [
      "*a **b ".repeat(4000),
      "[a](".repeat(4000),
      "`a ``b ".repeat(4000),
      "$a ".repeat(8000),
      "<a ".repeat(8000),
      "&".repeat(16000),
      "| a ".repeat(4000),
    ];
    for (const input of inputs) {
      const start = performance.now();
      html(input);
      expect(performance.now() - start, input.slice(0, 12)).toBeLessThan(2000);
    }
  });
});
