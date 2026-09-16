import { describe, expect, it } from "vitest";

import { PX_PER_MM } from "./geometry";
import { MIN_MAJOR_SPACING, MIN_MINOR_SPACING, mmAt, rulerStep, rulerTicks, tickLabel } from "./rulerTicks";

describe("rulerStep", () => {
  it("las marcas mayores quedan al menos a 64 px, con el paso más fino posible", () => {
    for (const zoom of [0.25, 0.5, 1, 2, 4, 8]) {
      const scale = PX_PER_MM * zoom;
      const { major } = rulerStep(scale);
      expect(major * scale).toBeGreaterThanOrEqual(MIN_MAJOR_SPACING);
    }
    expect(rulerStep(PX_PER_MM).major).toBe(20); // 20 mm ≈ 75,6 px al 100 %
    expect(rulerStep(PX_PER_MM * 8).major).toBe(5); // 5 mm ≈ 151 px al 800 %
    expect(rulerStep(PX_PER_MM * 0.25).major).toBe(100);
  });
});

describe("rulerTicks", () => {
  it("el 0 cae justo en el borde de la página", () => {
    const origin = 137.25;
    const zero = rulerTicks(origin, PX_PER_MM, 1000).find((tick) => tick.mm === 0);
    expect(zero).toEqual({ position: origin, mm: 0, major: true });
  });

  it("hay marcas mayores y menores, cada una en su milímetro", () => {
    const ticks = rulerTicks(0, PX_PER_MM, 400);
    const { major, minor } = rulerStep(PX_PER_MM);
    expect(ticks.filter((tick) => tick.major).map((tick) => tick.mm)).toEqual([0, 20, 40, 60, 80, 100]);
    expect(ticks[1]).toMatchObject({ mm: minor, major: false });
    for (const tick of ticks) {
      expect(tick.position).toBeCloseTo(tick.mm * PX_PER_MM, 9);
      expect(tick.major).toBe(Math.abs(tick.mm % major) < 1e-9);
    }
  });

  it("antes de la página, los milímetros son negativos", () => {
    const ticks = rulerTicks(300, PX_PER_MM, 400);
    expect(ticks[0]?.mm).toBeLessThan(0);
    expect(ticks.every((tick) => tick.position >= 0 && tick.position <= 400)).toBe(true);
  });

  it("si las menores quedarían demasiado juntas, solo hay mayores", () => {
    // Una escala tan pequeña que ni el paso más grande separa las menores.
    const scale = 0.03;
    const { minor } = rulerStep(scale);
    expect(minor * scale).toBeLessThan(MIN_MINOR_SPACING);
    expect(rulerTicks(0, scale, 1000).every((tick) => tick.major)).toBe(true);
  });

  it("los pasos de medio milímetro caen exactos", () => {
    const ticks = rulerTicks(0, 100, 1000);
    expect(ticks.map((tick) => tick.mm)).toContain(9.5);
    expect(ticks.filter((tick) => tick.major).map((tick) => tick.mm)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("sin escala o sin longitud no hay marcas", () => {
    expect(rulerTicks(0, 0, 100)).toEqual([]);
    expect(rulerTicks(0, PX_PER_MM, 0)).toEqual([]);
  });
});

describe("mmAt y tickLabel", () => {
  it("mmAt es la inversa de la posición", () => {
    expect(mmAt(100 + 25.4 * PX_PER_MM, 100, PX_PER_MM)).toBeCloseTo(25.4, 9);
  });

  it("las etiquetas no llevan ceros ni signos de más", () => {
    expect(tickLabel(20)).toBe("20");
    expect(tickLabel(-0)).toBe("0");
    expect(tickLabel(-40)).toBe("-40");
    expect(tickLabel(1.5)).toBe("1.5");
  });
});
