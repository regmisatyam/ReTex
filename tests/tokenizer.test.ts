import { describe, it, expect } from "vitest";
import { tokenize } from "../src/tokenizer/index.js";
import { TokenType } from "../src/types/index.js";

const types = (src: string): TokenType[] => tokenize(src).tokens.map((t) => t.type);

const values = (src: string): string[] =>
  tokenize(src)
    .tokens.filter((t) => t.type !== TokenType.EOF)
    .map((t) => t.value);

describe("tokenizer", () => {
  it("always ends with EOF", () => {
    const { tokens } = tokenize("");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.type).toBe(TokenType.EOF);
  });

  it("lexes a command without the backslash", () => {
    const { tokens } = tokenize("\\section");
    expect(tokens[0]!.type).toBe(TokenType.Command);
    expect(tokens[0]!.value).toBe("section");
  });

  it("lexes starred command variants", () => {
    expect(values("\\section*")).toEqual(["section*"]);
  });

  it("lexes internal hyphens as part of a compound command name", () => {
    expect(values("\\email-icon")).toEqual(["email-icon"]);
    expect(values("\\github-icon{}")).toEqual(["github-icon", "{", "}"]);
  });

  it("keeps a trailing hyphen (not followed by a letter) as literal text", () => {
    expect(values("\\foo-")).toEqual(["foo", "-"]);
    expect(values("\\foo-1")).toEqual(["foo", "-1"]);
  });

  it("lexes braces and brackets", () => {
    expect(types("{}[]")).toEqual([
      TokenType.LBrace,
      TokenType.RBrace,
      TokenType.LBracket,
      TokenType.RBracket,
      TokenType.EOF,
    ]);
  });

  it("treats a lone % as a literal percent sign", () => {
    expect(values("40%")).toEqual(["40%"]);
    expect(types("40%")).toEqual([TokenType.Text, TokenType.EOF]);
  });

  it("treats %% as a comment to end of line", () => {
    const { tokens } = tokenize("a %% comment\nb");
    const comment = tokens.find((t) => t.type === TokenType.Comment);
    expect(comment).toBeTruthy();
    expect(comment!.value).toContain("comment");
  });

  it("handles escapes as literal text", () => {
    expect(values("\\%")).toEqual(["%"]);
    expect(values("\\{")).toEqual(["{"]);
    expect(values("\\}")).toEqual(["}"]);
    expect(values("\\&")).toEqual(["&"]);
    expect(values("\\_")).toEqual(["_"]);
    expect(values("\\$")).toEqual(["$"]);
  });

  it("lexes \\\\ as a line break", () => {
    expect(types("a\\\\b")).toEqual([
      TokenType.Text,
      TokenType.LineBreak,
      TokenType.Text,
      TokenType.EOF,
    ]);
  });

  it("distinguishes a paragraph break from inline whitespace", () => {
    expect(tokenize("a b").tokens[1]!.type).toBe(TokenType.Whitespace);
    expect(tokenize("a\n\nb").tokens[1]!.type).toBe(TokenType.ParBreak);
    expect(tokenize("a\nb").tokens[1]!.type).toBe(TokenType.Whitespace);
  });

  it("tracks line and column positions", () => {
    const { tokens } = tokenize("\\a\n\\b");
    expect(tokens[0]!.range.start).toMatchObject({ line: 1, column: 1, offset: 0 });
    const second = tokens.find((t, i) => i > 0 && t.type === TokenType.Command)!;
    expect(second.range.start.line).toBe(2);
  });

  it("normalizes CRLF newlines", () => {
    expect(types("a\r\n\r\nb")).toEqual([
      TokenType.Text,
      TokenType.ParBreak,
      TokenType.Text,
      TokenType.EOF,
    ]);
  });

  it("never throws on adversarial input", () => {
    for (const s of ["\\", "{{{{", "}}}}", "\\\\\\\\", "%%%%", "[\\]"]) {
      expect(() => tokenize(s)).not.toThrow();
    }
  });

  it("produces contiguous, gap-free ranges covering the source", () => {
    const src = "\\textbf{Hi} 40% \\\\ x";
    const { tokens } = tokenize(src);
    let cursor = 0;
    for (const t of tokens) {
      if (t.type === TokenType.EOF) break;
      expect(t.range.start.offset).toBe(cursor);
      cursor = t.range.end.offset;
    }
    expect(cursor).toBe(src.length);
  });
});
