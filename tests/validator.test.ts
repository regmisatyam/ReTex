import { describe, it, expect } from "vitest";
import { tokenize, parse, validate, applyLibraries } from "../src/index.js";
import { DiagnosticCode, getTheme, createDefaultRegistry } from "../src/index.js";

// \themecolor lives in the `colors` library; validate against a styled theme so
// the theme-color check has a palette to check against.
const registry = applyLibraries(createDefaultRegistry(), ["colors"]).registry;
const diags = (src: string) => {
  const { ast } = parse(tokenize(src).tokens, { registry });
  return validate(ast, { theme: getTheme("modern") });
};
const codes = (src: string) => diags(src).map((d) => d.code);

describe("validator", () => {
  it("flags \\item outside a list", () => {
    expect(codes("\\item orphan")).toContain(DiagnosticCode.CommandOutsideContext);
  });

  it("flags \\column outside columns", () => {
    expect(codes("\\column{50%} x")).toContain(DiagnosticCode.CommandOutsideContext);
  });

  it("does not flag \\item inside a list", () => {
    expect(codes("\\begin{itemize}\\item ok\\end{itemize}")).not.toContain(
      DiagnosticCode.CommandOutsideContext,
    );
  });

  it("warns about empty section headings", () => {
    expect(codes("\\section{}")).toContain(DiagnosticCode.EmptyArgument);
  });

  it("warns about empty contact fields", () => {
    expect(codes("\\email{}")).toContain(DiagnosticCode.EmptyArgument);
  });

  it("warns about unknown theme colors", () => {
    expect(codes("\\themecolor{nope}{x}")).toContain(DiagnosticCode.UnknownThemeColor);
  });

  it("accepts known theme colors", () => {
    expect(codes("\\themecolor{primary}{x}")).not.toContain(
      DiagnosticCode.UnknownThemeColor,
    );
  });

  it("produces no diagnostics for a clean document", () => {
    const clean = `\\name{Jane}\n\\section{Experience}\n\\job{title=Eng, company=ACME}{Did work}`;
    expect(diags(clean)).toHaveLength(0);
  });

  it("tags every diagnostic with a source and range", () => {
    for (const d of diags("\\item x")) {
      expect(d.source).toBe("validator");
      expect(d.range).toBeTruthy();
    }
  });
});
