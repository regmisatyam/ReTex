import { describe, it, expect } from "vitest";
import {
  ReTeXEngine,
  IncrementalCompiler,
  extractFrontMatter,
  getBuiltinLibrary,
  parseMarkdown,
  printDocument,
  resolveLibraryName,
  texToMathML,
} from "../src/index.js";

const engine = new ReTeXEngine();
const html = (md: string): string => engine.toHtml(parseMarkdown(md).ast);

/** Names every plain object inherits. A lookup table must not treat them as keys. */
const INHERITED = [
  "constructor",
  "toString",
  "valueOf",
  "hasOwnProperty",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "toLocaleString",
  "__proto__",
];

describe("names inherited from Object.prototype", () => {
  for (const name of INHERITED) {
    describe(name, () => {
      it("TeX commands and environments", () => {
        for (const tex of [
          `\\${name}`,
          `\\${name}{x}`,
          `\\left\\${name} x \\right)`,
          `\\big\\${name}`,
          `\\begin{${name}} x \\end{${name}}`,
          `\\not\\${name}`,
          `\\${name} - x`,
        ]) {
          const { mathml } = texToMathML(tex);
          expect(mathml, tex).not.toContain("native code");
          expect(mathml, tex).not.toContain("function");
        }
        // Only letters make a control word, so `__proto__` can't be one.
        if (/^[a-zA-Z]+$/.test(name)) {
          expect(texToMathML(`\\${name}`).errors.length, name).toBeGreaterThan(0);
        }
      });

      it("Markdown entities and tags", () => {
        const entity = html(`a &${name}; b`);
        expect(entity).not.toContain("native code");
        // `__proto__` can't name an entity, and its underscores are emphasis anyway.
        if (/^[a-zA-Z]+$/.test(name)) expect(entity).toContain(`&amp;${name};`);
        const tag = html(`a <${name}>b</${name}> c`);
        expect(tag).not.toContain("native code");
      });

      it("styles and libraries", () => {
        expect(parseMarkdown("x", { style: name }).style).toBe("normal");
        expect(new ReTeXEngine().fromMarkdown("x", { style: name }).style).toBe("normal");
        expect(html(`---\nstyle: ${name}\n---\nx`)).toContain("retex-paper--normal");
        expect(getBuiltinLibrary(name)).toBeUndefined();
        expect(resolveLibraryName(name)).toBeUndefined();
        for (const src of [`\\usepackage{${name}}`, `\\documentclass{${name}}\nx`]) {
          expect(() => engine.toHtml(src), src).not.toThrow();
          expect(engine.toHtml(src), src).not.toContain("native code");
        }
      });

      it("ReTeX options and unknown commands", () => {
        for (const src of [
          `\\text[${name}]{x}`,
          `\\begin{table}[${name}]\\row{x}\\end{table}`,
          `\\documentclass[${name}]{ieee}\nx`,
          `\\${name.replace(/_/g, "")}{x}`,
          `\\begin{${name}}x\\end{${name}}`,
          `\\includegraphics[${name}=x]{a.png}`,
        ]) {
          const { ast, diagnostics } = engine.compile(src);
          for (const d of diagnostics) expect(d.message, src).not.toContain("native code");
          const out = engine.toHtml(ast);
          expect(out, src).not.toContain("native code");
          expect(() => printDocument(ast), src).not.toThrow();
        }
      });
    });
  }

  it("front matter with a __proto__ key pollutes nothing", () => {
    const { data } = extractFrontMatter("---\n__proto__: x\nconstructor: y\n---\nz");
    expect(({} as Record<string, unknown>).x).toBeUndefined();
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
    expect(data.constructor).toBe("y");
    expect(() =>
      parseMarkdown("---\n__proto__: [a]\nauthors:\n  - __proto__: x\n---\nz"),
    ).not.toThrow();
  });
});

describe("deep recursion", () => {
  const REPEATS = 100_000;
  for (const piece of [
    "\\sqrt",
    "\\frac",
    "\\mathbf",
    "\\hat",
    "\\overline",
    "\\not",
    "\\phantom",
    "\\boxed",
    "\\overset",
    "\\sum_",
    "x^",
    "x_",
    "^",
    "\\sqrt[",
    "\\substack{",
    "\\left(",
    "\\begin{matrix}",
  ]) {
    it(`TeX: ${piece} repeated`, () => {
      expect(() => texToMathML(piece.repeat(REPEATS))).not.toThrow();
    });
  }

  it("Markdown: display math made of deep commands", () => {
    expect(() => html(`$$${"\\sqrt".repeat(REPEATS)}$$`)).not.toThrow();
  });

  it("Markdown: emphasis nested far beyond what renderers can recurse over", () => {
    const md = `${"*a ".repeat(30_000)}b${" c*".repeat(30_000)}`;
    expect(() => html(md)).not.toThrow();
    expect(() => printDocument(parseMarkdown(md).ast)).not.toThrow();
    // Ordinary nesting still works, and the text survives either way.
    expect(html("*a **b *c* d** e*")).toContain("<em>a <strong>b <em>c</em> d</strong> e</em>");
    expect(html(md)).toContain("b");
  });

  it("Markdown: a long chain of footnotes citing footnotes", () => {
    const defs = Array.from({ length: 20_000 }, (_, i) => `[^${i}]: See[^${i + 1}]`).join("\n");
    expect(() => html(`Start[^0]\n\n${defs}`)).not.toThrow();
  });

  it("ReTeX: printing a stray or malformed node terminates", () => {
    for (const src of ["\\row{a}", "\\head{a}{b}", "\\caption{a}", "\\bibitem{a} b", "\\item a"]) {
      expect(() => printDocument(engine.compile(src).ast), src).not.toThrow();
    }
    expect(printDocument(engine.compile("\\row{a}{b}").ast)).toContain("\\row{a}{b}");
  });

  it("Markdown: alternating table rows and delimiters", () => {
    expect(() => html("| a |\n|---|\n".repeat(20_000))).not.toThrow();
  });

  it("ReTeX: nested environments of the new kinds", () => {
    for (const piece of [
      "\\begin{quote}",
      "\\begin{abstract}",
      "\\begin{figure}",
      "\\begin{table}",
      "\\footnote{",
      "\\caption{",
      "\\row{",
    ]) {
      expect(() => engine.toHtml(piece.repeat(20_000)), piece).not.toThrow();
    }
  });
});

describe("no quadratic blowups", () => {
  const LIMIT_MS = 3000;
  const timed = (name: string, fn: () => unknown): void => {
    it(name, () => {
      const start = performance.now();
      fn();
      expect(performance.now() - start).toBeLessThan(LIMIT_MS);
    });
  };
  const spaces = " ".repeat(200_000);

  timed("a heading with a long run of spaces", () => html(`# a${spaces}b`));
  timed("a paragraph with a long run of spaces before a newline", () =>
    html(`a${spaces}b\nc`),
  );
  timed("a long run of spaces that does end a line", () => html(`a${spaces}\nb`));
  timed("text in math with a long run of spaces", () =>
    texToMathML(`\\text{a${spaces}b}`),
  );
  timed("many named functions in a formula", () =>
    texToMathML(`x ${"\\log ".repeat(50_000)}`),
  );
  timed("many tags that are never closed", () => html("<sub>".repeat(30_000)));
  timed("many links with no closing tag", () => html('<a href="x">'.repeat(30_000)));
  timed("many script tags that are never closed", () => html("<script>a ".repeat(30_000)));
  timed("many open brackets", () => html("[".repeat(100_000)));
  timed("many images with no target", () => html("![a".repeat(50_000)));
  timed("many unclosed display environments", () =>
    html("\\begin{equation}\n".repeat(20_000)),
  );
  timed("many single dollars", () => html("$a ".repeat(50_000)));
  timed("many unclosed emphasis runs", () => html("*a _b ".repeat(30_000)));
  timed("many table rows", () =>
    html(`| a | b |\n|---|---|\n${"| 1 | 2 |\n".repeat(20_000)}`),
  );
  timed("many list items", () => html("- a\n".repeat(50_000)));
  timed("many paragraphs", () => html("a\n\n".repeat(50_000)));
  timed("many footnotes", () => {
    const defs = Array.from({ length: 5000 }, (_, i) => `[^${i}]: note`).join("\n");
    const refs = Array.from({ length: 5000 }, (_, i) => `[^${i}]`).join(" ");
    html(`${refs}\n\n${defs}`);
  });
  timed("many citations", () => {
    const list = Array.from({ length: 5000 }, (_, i) => `[${i + 1}] Ref.`).join("\n");
    html(`${"[1] ".repeat(20_000)}\n\n## References\n\n${list}`);
  });
  timed("printing and recompiling a large paper", () => {
    const source = printDocument(parseMarkdown("## A\n\ntext $x^2$\n\n".repeat(5000)).ast);
    new IncrementalCompiler().compile(source);
  });
});
