import { describe, it, expect } from "vitest";
import { tokenize } from "../src/tokenizer/index.js";
import { parse, createDefaultRegistry } from "../src/parser/index.js";
import { applyLibraries } from "../src/index.js";

// Styling commands live in libraries; enable them for these smoke tests.
const registry = applyLibraries(createDefaultRegistry(), [
  "colors",
  "fonts",
  "shapes",
]).registry;
const compile = (src: string) => {
  const { tokens } = tokenize(src);
  return parse(tokens, { registry });
};

describe("smoke", () => {
  it("tokenizes a section", () => {
    const { tokens } = tokenize("\\section{Experience}");
    expect(tokens.map((t) => t.type)).toEqual([
      "Command",
      "LBrace",
      "Text",
      "RBrace",
      "EOF",
    ]);
    expect(tokens[0]!.value).toBe("section");
  });

  it("parses nested typography", () => {
    const { ast, diagnostics } = compile("\\textcolor{blue}{\\textbf{OpenAI}}");
    expect(diagnostics).toHaveLength(0);
    const color = ast.children[0]!;
    expect(color.type).toBe("color");
    expect((color as any).color).toBe("blue");
    expect((color as any).children[0].type).toBe("bold");
  });

  it("handles literal percent and 40%", () => {
    const { ast } = compile("Reduced latency by 40%");
    const text = ast.children.map((n: any) => n.value ?? "").join("");
    expect(text).toContain("40%");
  });

  it("parses itemize into a list", () => {
    const { ast } = compile(
      "\\begin{itemize}\n\\item Built systems\n\\item Reduced latency\n\\end{itemize}",
    );
    const list = ast.children.find((n) => n.type === "list") as any;
    expect(list).toBeTruthy();
    expect(list.kind).toBe("itemize");
    expect(list.items).toHaveLength(2);
  });

  it("parses columns with widths", () => {
    const { ast } = compile(
      "\\begin{columns}\\column{40%} Left\\column{60%} Right\\end{columns}",
    );
    const cols = ast.children.find((n) => n.type === "columns") as any;
    expect(cols.columns).toHaveLength(2);
    expect(cols.columns[0].width).toBe("40%");
    expect(cols.columns[1].width).toBe("60%");
  });

  it("parses a job entry with key=value fields", () => {
    const { ast } = compile(
      "\\job{title=Senior Engineer, company=OpenAI, location=Remote, start=2023, end=Present}{Built AI systems}",
    );
    const job = ast.children.find((n) => n.type === "job") as any;
    expect(job.fields.title).toBe("Senior Engineer");
    expect(job.fields.company).toBe("OpenAI");
    expect(job.fields.end).toBe("Present");
  });

  it("recovers from an unterminated group", () => {
    const { ast, diagnostics } = compile("\\textbf{OpenAI");
    expect(diagnostics.length).toBeGreaterThan(0);
    expect(ast.children[0]!.type).toBe("bold");
  });

  it("blocks javascript: URLs", () => {
    const { ast, diagnostics } = compile("\\href{javascript:alert(1)}{click}");
    const link = ast.children[0] as any;
    expect(link.href).toBe("#");
    expect(diagnostics.some((d) => d.code === "RTX5001")).toBe(true);
  });

  it("applies a scoped font switch to the rest of its group", () => {
    const { ast } = compile("{\\Large Big text} normal");
    const group = ast.children[0] as any;
    expect(group.type).toBe("group");
    expect(group.children[0].type).toBe("fontscale");
    expect(group.children[0].scale).toBe("Large");
  });
});
