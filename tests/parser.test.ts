import { describe, it, expect } from "vitest";
import { tokenize } from "../src/tokenizer/index.js";
import { parse, createDefaultRegistry } from "../src/parser/index.js";
import { applyLibraries } from "../src/index.js";
import { DiagnosticCode, type DocumentNode, type Node } from "../src/types/index.js";

// Color / font / shape commands now live in libraries; enable them so these
// command-level unit tests can exercise their builders directly.
const registry = applyLibraries(createDefaultRegistry(), [
  "colors",
  "fonts",
  "shapes",
]).registry;
const compile = (src: string) => parse(tokenize(src).tokens, { registry });
const ast = (src: string): DocumentNode => compile(src).ast;
const first = (src: string): Node =>
  ast(src).children.find((n) => n.type !== "text" || n.value.trim() !== "")!;
const codes = (src: string): string[] => compile(src).diagnostics.map((d) => d.code);

describe("parser — typography", () => {
  it("parses simple marks", () => {
    expect(first("\\textbf{Hi}").type).toBe("bold");
    expect(first("\\textit{Hi}").type).toBe("italic");
    expect(first("\\underline{Hi}").type).toBe("underline");
  });

  it("parses textcolor with a color and content", () => {
    const node = first("\\textcolor{#2563eb}{ACME}") as any;
    expect(node.type).toBe("color");
    expect(node.color).toBe("#2563eb");
    expect(node.children[0].value).toBe("ACME");
  });

  it("parses fontsize and fontfamily", () => {
    expect((first("\\fontsize{14pt}{Big}") as any).size).toBe("14pt");
    expect((first("\\fontfamily{Georgia}{X}") as any).family).toBe("Georgia");
  });

  it("supports unlimited nesting", () => {
    const node = first("\\textcolor{blue}{\\textbf{\\textit{\\underline{deep}}}}") as any;
    expect(node.type).toBe("color");
    expect(node.children[0].type).toBe("bold");
    expect(node.children[0].children[0].type).toBe("italic");
    expect(node.children[0].children[0].children[0].type).toBe("underline");
  });

  it("treats \\small/\\Large as scoped switches", () => {
    const group = first("{\\Large big}") as any;
    expect(group.type).toBe("group");
    expect(group.children[0].type).toBe("fontscale");
    expect(group.children[0].scale).toBe("Large");
    expect(group.children[0].children.map((n: any) => n.value).join("")).toContain("big");
  });

  it("bounds a switch to its enclosing group", () => {
    const doc = ast("{\\Large big} small");
    const group = doc.children[0] as any;
    expect(group.children[0].type).toBe("fontscale");
    // "small" after the group is NOT inside the switch
    const tail = doc.children
      .slice(1)
      .map((n: any) => n.value ?? "")
      .join("");
    expect(tail).toContain("small");
  });
});

describe("parser — links", () => {
  it("parses href and url", () => {
    const link = first("\\href{https://x.com}{X}") as any;
    expect(link.type).toBe("link");
    expect(link.href).toBe("https://x.com");
    const url = first("\\url{https://y.com}") as any;
    expect(url.type).toBe("url");
  });
});

describe("parser — sections & resume components", () => {
  it("parses sections with levels", () => {
    expect((first("\\section{Experience}") as any).title).toBe("Experience");
    expect((first("\\subsection{Sub}") as any).level).toBe(2);
  });

  it("parses contact fields", () => {
    expect(first("\\name{Jane Doe}") as any).toMatchObject({
      type: "contact",
      field: "name",
      value: "Jane Doe",
    });
    expect((first("\\email{a@b.com}") as any).field).toBe("email");
  });

  it("parses a job with key=value fields and a body", () => {
    const job = first(
      "\\job{title=Eng, company=ACME, start=2020, end=2024}{Did work}",
    ) as any;
    expect(job.type).toBe("job");
    expect(job.fields).toMatchObject({
      title: "Eng",
      company: "ACME",
      start: "2020",
      end: "2024",
    });
    expect(job.children.length).toBeGreaterThan(0);
  });

  it("allows an omitted (optional) job body", () => {
    const job = first("\\job{title=Eng, company=ACME}") as any;
    expect(job.type).toBe("job");
    expect(job.children).toHaveLength(0);
  });

  it("handles unquoted commas in field values", () => {
    const job = first("\\job{title=Eng, company=ACME, location=New York, NY}") as any;
    expect(job.fields.location).toBe("New York, NY");
  });

  it("parses education and skills", () => {
    expect((first("\\education{school=MIT, degree=BS}") as any).fields.school).toBe(
      "MIT",
    );
    expect((first("\\skills{A, B, C}") as any).items).toEqual(["A", "B", "C"]);
  });
});

describe("parser — environments", () => {
  it("parses itemize into a list", () => {
    const list = first("\\begin{itemize}\\item a\\item b\\end{itemize}") as any;
    expect(list.type).toBe("list");
    expect(list.kind).toBe("itemize");
    expect(list.items).toHaveLength(2);
  });

  it("parses enumerate", () => {
    expect((first("\\begin{enumerate}\\item a\\end{enumerate}") as any).kind).toBe(
      "enumerate",
    );
  });

  it("parses nested lists", () => {
    const outer = first(
      "\\begin{itemize}\\item top \\begin{itemize}\\item inner\\end{itemize}\\end{itemize}",
    ) as any;
    const innerList = outer.items[0].children.find((n: any) => n.type === "list");
    expect(innerList).toBeTruthy();
    expect(innerList.items[0].children.map((n: any) => n.value).join("")).toContain(
      "inner",
    );
  });

  it("parses columns with widths", () => {
    const cols = first(
      "\\begin{columns}\\column{40%}L\\column{60%}R\\end{columns}",
    ) as any;
    expect(cols.type).toBe("columns");
    expect(cols.columns.map((c: any) => c.width)).toEqual(["40%", "60%"]);
  });
});

describe("parser — error recovery", () => {
  it("recovers from an unterminated argument and still builds the node", () => {
    const c = compile("\\textbf{OpenAI");
    expect(c.ast.children[0]!.type).toBe("bold");
    expect(c.diagnostics.map((d) => d.code)).toContain(
      DiagnosticCode.UnterminatedArgument,
    );
  });

  it("flags an unterminated bare group", () => {
    const c = compile("{OpenAI");
    expect(c.diagnostics.map((d) => d.code)).toContain(DiagnosticCode.UnterminatedGroup);
  });

  it("flags unknown commands and suggests a correction", () => {
    const c = compile("\\sectionn{X}");
    const diag = c.diagnostics.find((d) => d.code === DiagnosticCode.UnknownCommand)!;
    expect(diag).toBeTruthy();
    expect(diag.message).toContain("section");
    expect(diag.fixes?.[0]?.replacement).toBe("\\section");
  });

  it("flags a mismatched environment end", () => {
    expect(codes("\\begin{itemize}\\item a\\end{enumerate}")).toContain(
      DiagnosticCode.MismatchedEnvironment,
    );
  });

  it("flags a stray closing brace", () => {
    expect(codes("hello}")).toContain(DiagnosticCode.MismatchedBrace);
  });

  it("flags a stray \\end", () => {
    expect(codes("\\end{itemize}")).toContain(DiagnosticCode.MismatchedEnvironment);
  });

  it("continues parsing after an error", () => {
    const doc = ast("\\textbf{ \\section{After}");
    const section = doc.children
      .flatMap((n: any) => [n, ...(n.children ?? [])])
      .find((n: any) => n.type === "section");
    expect(section).toBeTruthy();
  });

  it("never throws on malformed input", () => {
    for (const s of [
      "\\job{",
      "\\begin{itemize}",
      "{{{",
      "\\textcolor{}{}",
      "\\href{}",
    ]) {
      expect(() => compile(s)).not.toThrow();
    }
  });
});

describe("parser — source ranges", () => {
  it("attaches ranges to nodes", () => {
    const node = first("\\textbf{Hi}");
    expect(node.range).toBeTruthy();
    expect(node.range!.start.offset).toBe(0);
    expect(node.range!.end.offset).toBe("\\textbf{Hi}".length);
  });
});
