import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { ReTeXEngine } from "../engine.js";
import { printDocument } from "../editor/printer.js";
import { renderJson } from "../renderers/index.js";
import { paperStyleNames, paperStyleSummaries } from "../theme/index.js";
import type { Diagnostic, DocumentNode } from "../types/index.js";
import { DiagnosticSeverity } from "../types/index.js";
import type { MarkdownOptions } from "../markdown/index.js";

declare const __RETEX_VERSION__: string;

const USAGE = `retex — turn Markdown or ReTeX into a research paper

Usage:
  retex <input> [options]
  pbpaste | retex - --style ieee -o paper.pdf

Input is a .md or .retex file, or - for standard input (read as Markdown).

Options:
  -o, --output <file>   Write here. The extension picks the format: .html, .pdf,
                        .retex, .json. Without this, HTML goes to standard output.
  -f, --format <name>   html, pdf, retex, or json, overriding the extension.
  -s, --style <name>    Paper style (Markdown input only). See --list-styles.
      --columns <1|2>   Text columns per page, overriding the style.
      --page <size>     letter or a4, overriding the style.
      --font-size <pt>  10pt, 11pt, or 12pt, overriding the style.
      --numbered        Number sections automatically, overriding the style.
      --no-numbers      Do not number sections, overriding the style.
      --title <text>    Paper title, overriding the document.
      --author <name>   An author, overriding the document. Repeatable.
      --keep-chatter    Keep "Sure! Here's…" lines and AI citation markers.
  -q, --quiet           Only print errors.
      --list-styles     List the paper styles and exit.
  -h, --help            Show this help and exit.
  -v, --version         Show the version and exit.

PDF output uses Chrome, Edge, or Chromium if one is installed (set RETEX_CHROME to
choose a specific one), and otherwise puppeteer if that is installed.
`;

/** Where to write and how to report, so tests can run the CLI in-process. */
export interface CliIO {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  readStdin: () => string;
}

const defaultIO: CliIO = {
  stdout: (text) => void process.stdout.write(text),
  stderr: (text) => void process.stderr.write(text),
  readStdin: () => readFileSync(0, "utf8"),
};

type Format = "html" | "pdf" | "retex" | "json";

function formatFromExtension(path: string): Format | undefined {
  switch (extname(path).toLowerCase()) {
    case ".html":
    case ".htm":
      return "html";
    case ".pdf":
      return "pdf";
    case ".retex":
      return "retex";
    case ".json":
      return "json";
    default:
      return undefined;
  }
}

/** Find an installed Chromium-family browser. */
function findBrowser(): string | undefined {
  const fromEnv = process.env.RETEX_CHROME ?? process.env.CHROME_PATH;
  if (fromEnv) return fromEnv;

  if (process.platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    ].find(existsSync);
  }
  if (process.platform === "win32") {
    const roots = [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"]];
    const apps = ["Google\\Chrome\\Application\\chrome.exe", "Microsoft\\Edge\\Application\\msedge.exe"];
    for (const root of roots) {
      for (const app of apps) {
        if (root && existsSync(join(root, app))) return join(root, app);
      }
    }
    return undefined;
  }
  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"]) {
    const found = spawnSync("which", [name], { encoding: "utf8" });
    if (found.status === 0 && found.stdout.trim()) return found.stdout.trim();
  }
  return undefined;
}

/**
 * Print a page to PDF with an installed browser. The page is written next to the
 * source so relative image paths resolve, and the browser gets a throwaway profile
 * so the user's own is never touched.
 */
function printWithBrowser(browser: string, html: string, baseDir: string, output: string): string | undefined {
  const profile = mkdtempSync(join(tmpdir(), "retex-chrome-"));
  const candidates = [baseDir, profile];
  let page: string | undefined;
  for (const dir of candidates) {
    const path = join(dir, `.retex-print-${process.pid}.html`);
    try {
      writeFileSync(path, html, "utf8");
      page = path;
      break;
    } catch {
      // A read-only source folder: images may not resolve, but the text still prints.
    }
  }
  try {
    if (!page) return "Could not write a temporary file.";
    const result = spawnSync(
      browser,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--no-pdf-header-footer",
        `--user-data-dir=${profile}`,
        `--print-to-pdf=${output}`,
        pathToFileURL(page).href,
      ],
      { encoding: "utf8", timeout: 120_000 },
    );
    if (result.error) return result.error.message;
    if (result.status !== 0 || !existsSync(output)) {
      return result.stderr.trim().split("\n").slice(-3).join("\n") || "The browser failed.";
    }
    return undefined;
  } finally {
    if (page) rmSync(page, { force: true });
    rmSync(profile, { recursive: true, force: true });
  }
}

function printDiagnostics(diagnostics: Diagnostic[], name: string, quiet: boolean, io: CliIO): void {
  for (const d of diagnostics) {
    if (quiet && d.severity !== DiagnosticSeverity.Error) continue;
    if (d.severity === DiagnosticSeverity.Hint) continue;
    io.stderr(`${name}:${d.range.start.line}: ${d.severity}: ${d.message}\n`);
  }
}

/** Run the CLI and return its exit code. */
export async function runCli(argv: string[], io: CliIO = defaultIO): Promise<number> {
  let args: ReturnType<typeof parse>;
  try {
    args = parse(argv);
  } catch (error) {
    io.stderr(`${(error as Error).message}\n\n${USAGE}`);
    return 2;
  }
  const { values, positionals } = args;

  if (values.help) {
    io.stdout(USAGE);
    return 0;
  }
  if (values.version) {
    io.stdout(`${typeof __RETEX_VERSION__ === "string" ? __RETEX_VERSION__ : "dev"}\n`);
    return 0;
  }
  if (values["list-styles"]) {
    for (const name of paperStyleNames()) {
      io.stdout(`${name.padEnd(9)} ${paperStyleSummaries[name]}\n`);
    }
    return 0;
  }

  const input = positionals[0];
  if (input === undefined || positionals.length > 1) {
    io.stderr(USAGE);
    return 2;
  }

  const output = values.output;
  const format: Format =
    (values.format as Format | undefined) ?? (output ? formatFromExtension(output) : undefined) ?? "html";
  if (!["html", "pdf", "retex", "json"].includes(format)) {
    io.stderr(`Unknown format "${format}". Use html, pdf, retex, or json.\n`);
    return 2;
  }
  if (format === "pdf" && !output) {
    io.stderr("PDF output needs a file: use -o paper.pdf.\n");
    return 2;
  }
  if (values.style !== undefined && !paperStyleNames().includes(values.style.toLowerCase())) {
    io.stderr(`Unknown style "${values.style}". Available: ${paperStyleNames().join(", ")}.\n`);
    return 2;
  }

  let source: string;
  try {
    source = input === "-" ? io.readStdin() : readFileSync(input, "utf8");
  } catch (error) {
    io.stderr(`Could not read ${input}: ${(error as Error).message}\n`);
    return 1;
  }

  const name = input === "-" ? "<stdin>" : basename(input);
  const isRetex = input !== "-" && extname(input).toLowerCase() === ".retex";
  const engine = new ReTeXEngine();
  let ast: DocumentNode;
  let diagnostics: Diagnostic[];

  if (isRetex) {
    if (values.style !== undefined) {
      io.stderr(`--style only applies to Markdown. In ${name}, use \\documentclass{${values.style}}.\n`);
    }
    ({ ast, diagnostics } = engine.compile(source));
  } else {
    ({ ast, diagnostics } = engine.fromMarkdown(source, markdownOptions(values)));
  }
  printDiagnostics(diagnostics, name, values.quiet ?? false, io);
  if (diagnostics.some((d) => d.severity === DiagnosticSeverity.Error)) return 1;

  if (format === "retex" || format === "json" || format === "html") {
    const text =
      format === "retex"
        ? printDocument(ast)
        : format === "json"
          ? `${renderJson(ast, { stripMeta: true })}\n`
          : engine.toHtmlDocument(ast);
    if (!output) {
      io.stdout(text);
      return 0;
    }
    writeFileSync(output, text, "utf8");
    return 0;
  }

  const target = resolve(output!);
  const baseDir = input === "-" ? process.cwd() : dirname(resolve(input));
  const browser = findBrowser();
  if (browser) {
    const failure = printWithBrowser(browser, engine.toPrintHtml(ast), baseDir, target);
    if (failure) {
      io.stderr(`PDF export failed: ${failure}\n`);
      return 1;
    }
    return 0;
  }
  try {
    writeFileSync(target, await engine.toPdf(ast));
    return 0;
  } catch (error) {
    io.stderr(
      `No browser found for PDF export. Install Chrome or Chromium, set RETEX_CHROME, ` +
        `or run "npm i puppeteer". You can also write -o paper.html and print it from a browser.\n` +
        `(${(error as Error).message})\n`,
    );
    return 1;
  }
}

function parse(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      output: { type: "string", short: "o" },
      format: { type: "string", short: "f" },
      style: { type: "string", short: "s" },
      columns: { type: "string" },
      page: { type: "string" },
      "font-size": { type: "string" },
      numbered: { type: "boolean" },
      "no-numbers": { type: "boolean" },
      title: { type: "string" },
      author: { type: "string", multiple: true },
      "keep-chatter": { type: "boolean" },
      quiet: { type: "boolean", short: "q" },
      "list-styles": { type: "boolean" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });
}

function markdownOptions(values: ReturnType<typeof parse>["values"]): MarkdownOptions {
  const options: MarkdownOptions = {};
  if (values.style !== undefined) options.style = values.style;
  if (values.columns === "1") options.columns = 1;
  else if (values.columns === "2") options.columns = 2;
  const page = values.page?.toLowerCase();
  if (page === "a4") options.pageSize = "A4";
  else if (page === "letter") options.pageSize = "Letter";
  const size = values["font-size"]?.toLowerCase();
  if (size === "10pt" || size === "11pt" || size === "12pt") options.fontSize = size;
  if (values.numbered) options.numbering = true;
  if (values["no-numbers"]) options.numbering = false;
  if (values.title !== undefined) options.title = values.title;
  if (values.author) options.authors = values.author;
  if (values["keep-chatter"]) options.stripChatter = false;
  return options;
}
