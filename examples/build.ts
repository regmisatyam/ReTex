/**
 * Render the examples to standalone HTML in `examples/rendered/`:
 *
 *  - every `examples/*.retex` file, styled by the libraries it imports
 *  - `examples/ai-response.md`, once in each paper style
 *
 * Run with:  `npx tsx examples/build.ts`
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { ReTeXEngine, DiagnosticSeverity, paperStyleNames } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "rendered");
mkdirSync(outDir, { recursive: true });

const files = readdirSync(here).filter((f) => f.endsWith(".retex"));
for (const file of files) {
  const name = basename(file, ".retex");
  const source = readFileSync(join(here, file), "utf8");
  const engine = new ReTeXEngine();

  const { diagnostics } = engine.compile(source);
  const errors = diagnostics.filter((d) => d.severity === DiagnosticSeverity.Error);
  for (const d of diagnostics) {
    const where = `${d.range.start.line}:${d.range.start.column}`;
    console.log(`  [${d.severity}] ${file}:${where} ${d.code} ${d.message}`);
  }
  if (errors.length > 0) {
    console.error(`✗ ${file}: ${errors.length} error(s)`);
    process.exitCode = 1;
  }

  const html = engine.toHtmlDocument(source);
  writeFileSync(join(outDir, `${name}.html`), html, "utf8");
  console.log(`✓ ${file} → rendered/${name}.html (${html.length} bytes)`);
}

// The sample's image sits next to it, one level above the rendered pages.
const answer = readFileSync(join(here, "ai-response.md"), "utf8").replaceAll(
  "](sparse-attention.png",
  "](../sparse-attention.png",
);
for (const style of paperStyleNames()) {
  const engine = new ReTeXEngine();
  const { ast } = engine.fromMarkdown(answer, { style });
  const html = engine.toHtmlDocument(ast);
  writeFileSync(join(outDir, `ai-response-${style}.html`), html, "utf8");
  console.log(`✓ ai-response.md → rendered/ai-response-${style}.html (${html.length} bytes)`);
}
