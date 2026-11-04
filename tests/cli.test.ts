import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli, type CliIO } from "../src/cli/run.js";

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "retex-cli-"));
  writeFileSync(join(dir, "in.md"), "Sure! Here you go:\n\n# My Paper\n\n## 1. Intro\n\nBody $x^2$.");
  writeFileSync(join(dir, "in.retex"), "\\documentclass{acm}\n\\title{From ReTeX}\n\\section{A}\nx");
  writeFileSync(join(dir, "bad.retex"), "\\begin{itemize}\\item a");
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function cli(args: string[], stdin = "") {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIO = {
    stdout: (t) => out.push(t),
    stderr: (t) => err.push(t),
    readStdin: () => stdin,
  };
  const code = await runCli(args, io);
  return { code, out: out.join(""), err: err.join("") };
}

describe("cli", () => {
  it("writes HTML to standard output by default", async () => {
    const { code, out } = await cli([join(dir, "in.md"), "--style", "ieee", "-q"]);
    expect(code).toBe(0);
    expect(out).toContain("<!DOCTYPE html>");
    expect(out).toContain("retex-paper--ieee");
  });

  it("picks the format from the output's extension", async () => {
    for (const [file, marker] of [
      ["a.html", "<!DOCTYPE html>"],
      ["b.retex", "\\documentclass{ieee}"],
      ["c.json", '"type": "document"'],
    ] as const) {
      const path = join(dir, file);
      const { code } = await cli([join(dir, "in.md"), "--style", "ieee", "-q", "-o", path]);
      expect(code, file).toBe(0);
      expect(readFileSync(path, "utf8"), file).toContain(marker);
    }
  });

  it("--format overrides the extension", async () => {
    const path = join(dir, "d.txt");
    await cli([join(dir, "in.md"), "-f", "retex", "-q", "-o", path]);
    expect(readFileSync(path, "utf8")).toContain("\\documentclass{normal}");
  });

  it("reads standard input as Markdown", async () => {
    const { code, out } = await cli(["-", "-f", "retex", "-q"], "# From stdin\n\nx");
    expect(code).toBe(0);
    expect(out).toContain("\\title{From stdin}");
  });

  it("compiles .retex input, whose own \\documentclass applies", async () => {
    const { code, out } = await cli([join(dir, "in.retex")]);
    expect(code).toBe(0);
    expect(out).toContain("retex-paper--acm");
    expect(out).toContain("From ReTeX");
  });

  it("says so when --style cannot apply", async () => {
    const { err } = await cli([join(dir, "in.retex"), "--style", "ieee"]);
    expect(err).toContain("\\documentclass{ieee}");
  });

  it("applies layout overrides", async () => {
    const run = async (...flags: string[]): Promise<string> =>
      (await cli([join(dir, "in.md"), "-f", "retex", "-q", ...flags])).out;
    expect(await run("--style", "ieee", "--columns", "1")).toContain("[onecolumn]{ieee}");
    expect(await run("--columns", "2")).toContain("[twocolumn]{normal}");
    expect(await run("--page", "a4")).toContain("[a4paper]");
    expect(await run("--font-size", "12pt")).toContain("[12pt]");
    expect(await run("--no-numbers")).toContain("[nonumbers]");
    expect(await run("--numbered")).toContain("[numbered]");
    expect(await run("--title", "Other")).toContain("\\title{Other}");
    expect(await run("--author", "A", "--author", "B")).toMatch(/\\author\{A\}\s+\\author\{B\}/);
  });

  it("reports removed chatter, unless quiet or told to keep it", async () => {
    const input = join(dir, "in.md");
    expect((await cli([input])).err).toContain("Removed opening chatter");
    expect((await cli([input, "-q"])).err).toBe("");
    const kept = await cli([input, "--keep-chatter", "-f", "retex"]);
    expect(kept.err).toBe("");
    expect(kept.out).toContain("Sure! Here you go:");
  });

  it("fails clearly", async () => {
    const missing = await cli([join(dir, "nope.md")]);
    expect(missing.code).toBe(1);
    expect(missing.err).toContain("Could not read");

    const style = await cli([join(dir, "in.md"), "--style", "nope"]);
    expect(style.code).toBe(2);
    expect(style.err).toContain("ieee");

    expect((await cli([join(dir, "in.md"), "-f", "docx"])).code).toBe(2);
    expect((await cli([join(dir, "in.md"), "-f", "pdf"])).code).toBe(2);
    expect((await cli([])).code).toBe(2);
    expect((await cli(["a", "b"])).code).toBe(2);
    expect((await cli(["--nope"])).code).toBe(2);
  });

  it("a compile error stops the output and sets the exit code", async () => {
    const output = join(dir, "bad.html");
    const { code, err } = await cli([join(dir, "bad.retex"), "-o", output]);
    expect(code).toBe(1);
    expect(err).toContain("error");
    expect(existsSync(output)).toBe(false);
  });

  it("--help, --version, and --list-styles", async () => {
    expect((await cli(["--help"])).out).toContain("Usage:");
    expect((await cli(["-v"])).code).toBe(0);
    const { out } = await cli(["--list-styles"]);
    for (const name of ["normal", "ieee", "acm", "arxiv", "lncs", "apa", "journal"]) {
      expect(out).toContain(name);
    }
  });

  it("PDF export reports a browser failure and leaves no files behind", async () => {
    const before = readdirSync(dir).sort();
    const previous = process.env.RETEX_CHROME;
    process.env.RETEX_CHROME = join(dir, "no-such-browser");
    try {
      const { code, err } = await cli([join(dir, "in.md"), "-q", "-o", join(dir, "out.pdf")]);
      expect(code).toBe(1);
      expect(err).toContain("PDF export failed");
    } finally {
      if (previous === undefined) delete process.env.RETEX_CHROME;
      else process.env.RETEX_CHROME = previous;
    }
    expect(readdirSync(dir).sort()).toEqual(before);
  });
});
