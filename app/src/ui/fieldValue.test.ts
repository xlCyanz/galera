import { describe, expect, it } from "vitest";

import { SCRUB_PX_PER_STEP, formatNumber, parseNumber, scrubValue, stepFor } from "./fieldValue";

describe("formatNumber", () => {
  it("con coma decimal, dos decimales como mucho y sin separador de miles", () => {
    expect(formatNumber(12.5)).toBe("12,5");
    expect(formatNumber(60.000000000000014)).toBe("60");
    expect(formatNumber(1234.567)).toBe("1234,57");
    expect(formatNumber(-0.001)).toBe("0");
  });
});

describe("parseNumber", () => {
  it("acepta coma o punto, espacios y la unidad", () => {
    expect(parseNumber("12,5")).toBe(12.5);
    expect(parseNumber(" 12.5 ")).toBe(12.5);
    expect(parseNumber("30 mm")).toBe(30);
    expect(parseNumber("-15°")).toBe(-15);
    expect(parseNumber(",5")).toBe(0.5);
  });

  it("devuelve null si no es un número", () => {
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("abc")).toBeNull();
    expect(parseNumber("1,2,3")).toBeNull();
    expect(parseNumber("12px")).toBeNull();
  });
});

describe("stepFor", () => {
  it("1, 10 con Shift y 0,1 con Alt", () => {
    expect(stepFor({ shiftKey: false, altKey: false })).toBe(1);
    expect(stepFor({ shiftKey: true, altKey: false })).toBe(10);
    expect(stepFor({ shiftKey: false, altKey: true })).toBe(0.1);
  });
});

describe("scrubValue", () => {
  it("hacia arriba sube y hacia abajo baja, un paso cada pocos píxeles", () => {
    expect(scrubValue(10, -10 * SCRUB_PX_PER_STEP, 1)).toBe(20);
    expect(scrubValue(10, 3 * SCRUB_PX_PER_STEP, 1)).toBe(7);
    expect(scrubValue(10, -1, 1)).toBe(10);
    expect(scrubValue(10, -3 * SCRUB_PX_PER_STEP, 0.1)).toBe(10.3);
  });
});
