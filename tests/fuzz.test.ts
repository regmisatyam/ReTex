import { describe, it, expect } from "vitest";
import {
  ReTeXEngine,
  DiagnosticSeverity,
  tokenize,
  parse,
  texToMathML,
  parseMarkdown,
  printDocument,
  paperStyleNames,
} from "../src/index.js";

/** Tiny deterministic PRNG (mulberry32) so fuzz failures are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VOCAB = [
  "\\textbf",
  "\\textit",
  "\\section",
  "\\job",
  "\\begin",
  "\\end",
  "\\item",
  "\\column",
  "\\href",
  "\\icon",
  "\\textcolor",
  "\\skills",
  "{",
  "}",
  "[",
  "]",
  "%",
  "%%",
  "\\\\",
  "\\%",
  "\\{",
  "{itemize}",
  "{columns}",
  "{enumerate}",
  "Hello",
  "40%",
  "a@b.com",
  "=",
  ",",
  "title",
  "company",
  "\n",
  "\n\n",
  " ",
  "#fff",
  "https://x.com",
  "javascript:alert(1)",
  "\\",
  "🚀",
  "&<>\"'",
];

function randomDoc(rng: () => number, n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) {
    s += VOCAB[Math.floor(rng() * VOCAB.length)];
  }
  return s;
}

describe("fuzz — robustness", () => {
  const engine = new ReTeXEngine();

  it("never throws across thousands of random documents", () => {
    const rng = mulberry32(0xc0ffee);
    for (let i = 0; i < 3000; i++) {
      const doc = randomDoc(rng, 5 + Math.floor(rng() * 60));
      expect(
        () => {
          const { ast, diagnostics } = engine.compile(doc, { validate: true });
          expect(ast.type).toBe("document");
          expect(Array.isArray(diagnostics)).toBe(true);
          engine.toHtml(ast);
          engine.toJson(ast);
        },
        `seed doc: ${JSON.stringify(doc)}`,
      ).not.toThrow();
    }
  });

  it("HTML output of fuzzed input never contains a live script or javascript: href", () => {
    const rng = mulberry32(0x1234);
    for (let i = 0; i < 2000; i++) {
      const doc = randomDoc(rng, 5 + Math.floor(rng() * 40));
      const out = engine.toHtml(doc);
      expect(out).not.toContain("<script");
      expect(out).not.toMatch(/href="javascript:/i);
    }
  });

  it("handles deeply nested commands", () => {
    expect(() => {
      const deep = "\\textbf{".repeat(500) + "x" + "}".repeat(500);
      const { ast } = parse(tokenize(deep).tokens);
      expect(ast.type).toBe("document");
    }).not.toThrow();
  });

  it("handles many unclosed groups", () => {
    expect(() => parse(tokenize("{".repeat(5000)).tokens)).not.toThrow();
    expect(() => parse(tokenize("}".repeat(5000)).tokens)).not.toThrow();
  });
});

const MARKDOWN_VOCAB = [
  "# ", "## ", "### ", "- ", "* ", "1. ", "2) ", "  ", "    ", "> ", "---", "***", "| ", " | ", "|---|",
  "|:--|--:|", "```", "```py", "~~~", "`", "``", "*", "**", "***", "_", "__", "~~", "$", "$$", "\\(",
  "\\)", "\\[", "\\]", "[", "]", "(", ")", "![", "](", "[^1]", "[^1]: ", "[1]", "[1, 2]", "[1-3]",
  "[@a]", "[r]: ", "<", ">", "</", "<br>", "<sub>", "</sub>", "<script>", "</script>", "<a href=\"",
  "&amp;", "&#", ";", "\\", "\\*", "%", "%%", "{", "}", "\\frac", "x^2", "_i", "https://x.org", "a@b.org",
  "Abstract", "**Abstract:** ", "**Keywords:** ", "**Authors:** ", "## References", "References", "Table 1: ",
  "Figure 1: ", "Sure! ", "Let me know ", "javascript:alert(1)", "🚀", "word", "two words", "\n", "\n", "\n\n",
  "\\begin{align}", "\\end{align}", "\\begin{code}", "\\end{code}", "---\n", "title: ", "[ ] ", "[x] ",
];

const TEX_VOCAB = [
  "\\frac", "\\sqrt", "\\left", "\\right", "\\middle", "\\begin{", "\\end{", "pmatrix", "cases", "align",
  "array", "{", "}", "[", "]", "(", ")", "^", "_", "&", "\\\\", "'", "~", "\\sum", "\\int", "\\log", "\\lim",
  "\\mathbf", "\\mathbb", "\\text", "\\hat", "\\not", "\\big", "\\operatorname", "\\operatorname*",
  "\\displaystyle", "\\limits", "\\xrightarrow", "\\substack", "\\textcolor", "\\hspace", "\\", "\\nosuch", "x",
  "1", ".", "+", "-", "=", "<", ">", "\"", " ", "\n", "α", "≤", "🚀",
];

describe("fuzz: markdown and math", () => {
  const pick = (rng: () => number, vocab: string[], n: number): string => {
    let s = "";
    for (let i = 0; i < n; i++) s += vocab[Math.floor(rng() * vocab.length)];
    return s;
  };

  it("Markdown never throws, in any style, on any output path", () => {
    const rng = mulberry32(0xbadc0de);
    const styles = paperStyleNames();
    const engine = new ReTeXEngine();
    for (let i = 0; i < 3000; i++) {
      const md = pick(rng, MARKDOWN_VOCAB, 3 + Math.floor(rng() * 50));
      const style = styles[i % styles.length]!;
      expect(() => {
        const { ast } = parseMarkdown(md, { style });
        engine.toHtml(ast);
        engine.toJson(ast);
        printDocument(ast);
      }, JSON.stringify(md)).not.toThrow();
    }
  });

  it("Markdown output never contains live markup from the input", () => {
    const rng = mulberry32(0xfeed);
    const engine = new ReTeXEngine();
    for (let i = 0; i < 3000; i++) {
      const md = pick(rng, MARKDOWN_VOCAB, 3 + Math.floor(rng() * 50));
      const html = engine.toHtml(parseMarkdown(md).ast);
      expect(html, JSON.stringify(md)).not.toMatch(/<script\b/i);
      expect(html, JSON.stringify(md)).not.toMatch(/(?:href|src)="\s*javascript:/i);
    }
  });

  it("printed .retex always compiles back without errors", () => {
    const rng = mulberry32(0xabc123);
    const engine = new ReTeXEngine();
    const failures: string[] = [];
    for (let i = 0; i < 3000; i++) {
      const md = pick(rng, MARKDOWN_VOCAB, 3 + Math.floor(rng() * 40));
      const source = printDocument(parseMarkdown(md, { style: "ieee" }).ast);
      const errors = engine
        .compile(source)
        .diagnostics.filter((d) => d.severity === DiagnosticSeverity.Error);
      if (errors.length > 0) failures.push(JSON.stringify(md));
    }
    expect(failures.slice(0, 5), `${failures.length} of 3000 failed`).toEqual([]);
  });

  it("TeX never throws or hangs, and only emits balanced markup", () => {
    const rng = mulberry32(0x7e57);
    for (let i = 0; i < 5000; i++) {
      const tex = pick(rng, TEX_VOCAB, 1 + Math.floor(rng() * 40));
      for (const display of [false, true]) {
        const { mathml } = texToMathML(tex, { display });
        expect(mathml, tex).not.toMatch(/<(?!\/?(?:math|semantics|annotation|m[a-z]+)\b)/);
        const open = (mathml.match(/<m[a-z]*\b/g) ?? []).length;
        const close = (mathml.match(/<\/m[a-z]*>/g) ?? []).length;
        expect(open, tex).toBe(close);
      }
    }
  });
});
