import { describe, expect, it } from "vitest";

import type { RenderedPage } from "./commands";
import { compilationSummary, svgDataUrl } from "./preview";

function page(overrides: Partial<RenderedPage>): RenderedPage {
  return {
    svg: "<svg/>",
    diagnostics: [],
    error: null,
    ms: 12.34,
    reused: false,
    revision: 1,
    ...overrides,
  };
}

describe("svgDataUrl", () => {
  it("codifica el SVG entero en una dirección data:", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>#1 & 2</text></svg>';
    const url = svgDataUrl(svg);

    expect(url.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
    expect(decodeURIComponent(url.slice(url.indexOf(",") + 1))).toBe(svg);
    expect(url).not.toContain("#");
  });
});

describe("compilationSummary", () => {
  it("usa el tiempo de la compilación que se hizo de verdad", () => {
    const pages = [page({ reused: true, ms: 3 }), page({ ms: 12.34 }), page({ reused: true })];
    expect(compilationSummary(pages)).toBe("3 páginas · compilado en 12,3 ms");
  });

  it("dice si todas se reutilizaron", () => {
    expect(compilationSummary([page({ reused: true, ms: 8 })])).toBe(
      "1 página · compilado en 8 ms, reutilizada",
    );
  });

  it("sin páginas no hay nada que resumir", () => {
    expect(compilationSummary([])).toBe("Sin páginas");
  });
});
