import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const { version } = JSON.parse(readFileSync("package.json", "utf8")) as {
  version: string;
};

export default defineConfig({
  entry: {
    index: "src/index.ts",
    react: "src/renderers/react.ts",
    library: "src/library/index.ts",
    cli: "src/cli/main.ts",
  },
  define: { __RETEX_VERSION__: JSON.stringify(version) },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  splitting: false,
  minify: false,
  target: "es2021",
  // React is an optional peer dependency — never bundle it.
  external: ["react"],
});
