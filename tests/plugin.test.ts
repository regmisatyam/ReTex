import { describe, it, expect } from "vitest";
import { ReTeXEngine, badgePlugin, ratingPlugin } from "../src/index.js";
import type { ReTeXPlugin, CommandNode } from "../src/index.js";

describe("plugin system", () => {
  it("registers a custom command with an HTML renderer", () => {
    const engine = new ReTeXEngine();
    engine.registerCommand({
      name: "badge",
      args: [{ kind: "content" }],
      render: {
        html: (node, ctx, kids) =>
          `<span class="${ctx.cls("badge")}">${kids((node as CommandNode).args[0]?.children ?? [])}</span>`,
      },
    });
    const out = engine.toHtml("\\badge{New}");
    expect(out).toContain('class="retex-badge"');
    expect(out).toContain("New");
  });

  it("installs example plugins via use()", () => {
    const engine = new ReTeXEngine().use(badgePlugin).use(ratingPlugin);
    expect(engine.toHtml("\\badge{Hi}")).toContain("retex-badge");
    expect(engine.toHtml("\\rating{4}")).toContain("retex-rating");
  });

  it("does not flag a plugin command as unknown", () => {
    const engine = new ReTeXEngine().use(badgePlugin);
    const { diagnostics } = engine.compile("\\badge{x}");
    expect(diagnostics).toHaveLength(0);
  });

  it("supports custom environments", () => {
    const quote: ReTeXPlugin = {
      name: "quote",
      environments: [
        {
          name: "quote",
          build: ({ body }) => ({
            type: "command",
            name: "center",
            args: [{ kind: "required", children: body }],
          }),
        },
      ],
    };
    const engine = new ReTeXEngine().use(quote);
    const out = engine.toHtml("\\begin{quote}wisdom\\end{quote}");
    expect(out).toContain("wisdom");
  });

  it("supports custom icons", () => {
    const engine = new ReTeXEngine();
    engine.registerIcon("rocket", { body: '<path d="M0 0h24v24H0z"/>' });
    expect(engine.toHtml("\\icon{rocket}")).toContain("<svg");
  });

  it("applies plugin theme overrides", () => {
    const purple: ReTeXPlugin = {
      name: "purple",
      theme: { colors: { primary: "#7c3aed" } },
    };
    const engine = new ReTeXEngine().use(purple);
    expect(engine.getTheme().colors?.primary).toBe("#7c3aed");
  });

  it("invalidates the cache when a plugin is added", () => {
    const engine = new ReTeXEngine();
    expect(engine.compile("\\badge{x}").diagnostics.length).toBeGreaterThan(0); // unknown
    engine.use(badgePlugin);
    expect(engine.compile("\\badge{x}").diagnostics).toHaveLength(0); // now known
  });
});
