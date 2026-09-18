import { describe, expect, it } from "vitest";

import { compilationStatusText, formatBytes, formatMs } from "./format";

describe("formatMs", () => {
  it("un decimal como mucho, con coma", () => {
    expect(formatMs(12.34)).toBe("12,3 ms");
    expect(formatMs(8)).toBe("8 ms");
  });
});

describe("compilationStatusText", () => {
  it("enseña el tiempo de la última compilación", () => {
    expect(compilationStatusText("ready", 12.34, false)).toBe("Compilado en 12,3 ms");
    expect(compilationStatusText("ready", 8, true)).toBe("Compilado en 8 ms (sin cambios)");
    expect(compilationStatusText("error", 3, false)).toBe("No compila (3 ms)");
  });

  it("sin compilación, lo dice", () => {
    expect(compilationStatusText("idle", null, false)).toBe("Sin documento");
    expect(compilationStatusText("compiling", 5, false)).toBe("Compilando…");
    expect(compilationStatusText("error", null, false)).toBe("No compila");
  });
});

describe("formatBytes", () => {
  it("en la unidad que toque, con un decimal", () => {
    expect(formatBytes(812)).toBe("812 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(12_595)).toBe("12,3 KB");
    expect(formatBytes(4.3 * 1024 * 1024)).toBe("4,3 MB");
  });
});
