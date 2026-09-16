import { describe, expect, it } from "vitest";

import { compilationSummary } from "./format";

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
