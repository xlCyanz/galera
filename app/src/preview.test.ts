import { describe, expect, it } from "vitest";

import { compilationSummary, svgDataUrl } from "./preview";

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
  it("dice cuántas páginas y cuánto tardó", () => {
    expect(compilationSummary(3, 12.34, false)).toBe("3 páginas · compilado en 12,3 ms");
  });

  it("dice si se reutilizó", () => {
    expect(compilationSummary(1, 8, true)).toBe("1 página · compilado en 8 ms, reutilizada");
  });

  it("sin compilación no hay tiempo", () => {
    expect(compilationSummary(0, null, false)).toBe("Sin compilar");
  });
});
