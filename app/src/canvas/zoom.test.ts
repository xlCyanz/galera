import { describe, expect, it } from "vitest";

import { MAX_ZOOM, MIN_ZOOM } from "../store/document";
import { PX_PER_MM } from "./geometry";
import {
  FIT_MARGIN,
  centerOn,
  MIN_VISIBLE,
  ZOOM_LEVELS,
  clampScroll,
  fitView,
  fitZoom,
  formatZoom,
  nextZoomLevel,
  pageOrigin,
  panBy,
  wheelPan,
  wheelZoom,
  zoomAround,
} from "./zoom";

const a4 = { width: 210 * PX_PER_MM, height: 297 * PX_PER_MM };
const viewport = { width: 1200, height: 800 };

/** El punto de la página, en px al 100 %, que queda bajo `point`. */
function pageAt(view: { zoom: number; scroll: { x: number; y: number } }, point: { x: number; y: number }) {
  const origin = pageOrigin(
    viewport,
    { width: a4.width * view.zoom, height: a4.height * view.zoom },
    view.scroll,
  );
  return { x: (point.x - origin.x) / view.zoom, y: (point.y - origin.y) / view.zoom };
}

describe("niveles de zoom", () => {
  it("van del 25 % al 800 %", () => {
    expect(ZOOM_LEVELS[0]).toBe(MIN_ZOOM);
    expect(ZOOM_LEVELS.at(-1)).toBe(MAX_ZOOM);
  });

  it("acercar y alejar pasan al nivel siguiente", () => {
    expect(nextZoomLevel(1, "in")).toBe(1.25);
    expect(nextZoomLevel(1, "out")).toBe(0.75);
    expect(nextZoomLevel(1.1, "in")).toBe(1.25);
    expect(nextZoomLevel(1.1, "out")).toBe(1);
    expect(nextZoomLevel(0.9995, "in")).toBe(1.25);
  });

  it("en los extremos se quedan en el límite", () => {
    expect(nextZoomLevel(8, "in")).toBe(8);
    expect(nextZoomLevel(0.25, "out")).toBe(0.25);
  });
});

describe("rueda", () => {
  it("con Ctrl, hacia arriba acerca y hacia abajo aleja", () => {
    expect(wheelZoom(1, -10, 0)).toBeGreaterThan(1);
    expect(wheelZoom(1, 10, 0)).toBeLessThan(1);
  });

  it("acercar y alejar lo mismo vuelve al zoom de partida", () => {
    expect(wheelZoom(wheelZoom(1.7, -37, 0), 37, 0)).toBeCloseTo(1.7, 12);
  });

  it("las líneas cuentan como 16 píxeles", () => {
    expect(wheelZoom(1, 1, 1)).toBeCloseTo(wheelZoom(1, 16, 0), 12);
  });

  it("el zoom no se sale de los límites", () => {
    expect(wheelZoom(8, -10_000, 0)).toBe(MAX_ZOOM);
    expect(wheelZoom(0.25, 10_000, 0)).toBe(MIN_ZOOM);
  });

  it("sin Ctrl desplaza lo que marca, y con Shift la vertical pasa a horizontal", () => {
    const base = { deltaX: 0, deltaY: 30, deltaMode: 0, shiftKey: false };
    expect(wheelPan(base, viewport)).toEqual({ x: 0, y: 30 });
    expect(wheelPan({ ...base, shiftKey: true }, viewport)).toEqual({ x: 30, y: 0 });
    expect(wheelPan({ ...base, deltaX: 5, deltaY: 7 }, viewport)).toEqual({ x: 5, y: 7 });
    expect(wheelPan({ ...base, deltaY: 1, deltaMode: 2 }, viewport)).toEqual({ x: 0, y: 800 });
  });
});

describe("ajustar a la ventana", () => {
  it("usa la dimensión que más limita, con margen, y centra", () => {
    const view = fitView(a4, viewport);
    expect(a4.height * view.zoom).toBeCloseTo(viewport.height - 2 * FIT_MARGIN, 6);
    expect(a4.width * view.zoom).toBeLessThanOrEqual(viewport.width - 2 * FIT_MARGIN);
    expect(view.scroll).toEqual({ x: 0, y: 0 });
  });

  it("queda dentro de los límites", () => {
    expect(fitZoom({ width: 100, height: 100 }, { width: 100_000, height: 100_000 })).toBe(MAX_ZOOM);
    expect(fitZoom({ width: 100, height: 100 }, { width: 1, height: 1 })).toBe(MIN_ZOOM);
    expect(fitZoom({ width: 100, height: 100 }, { width: -5, height: 50 })).toBe(MIN_ZOOM);
    expect(fitZoom({ width: 0, height: 100 }, { width: 50, height: 50 })).toBe(1);
  });
});

describe("posición de la página", () => {
  it("sin desplazar, queda centrada", () => {
    expect(pageOrigin(viewport, { width: 200, height: 100 }, { x: 0, y: 0 })).toEqual({ x: 500, y: 350 });
    expect(pageOrigin(viewport, { width: 200, height: 100 }, { x: -20, y: 5 })).toEqual({ x: 480, y: 355 });
  });

  it("desplazando, nunca se pierde de vista entera", () => {
    const page = { width: 400, height: 600 };
    const far = clampScroll({ x: 10_000, y: -10_000 }, viewport, page);
    const origin = pageOrigin(viewport, page, far);
    expect(origin.x).toBe(viewport.width - MIN_VISIBLE);
    expect(origin.y).toBe(MIN_VISIBLE - page.height);
  });

  it("una página más pequeña que el margen visible se queda entera", () => {
    const page = { width: 20, height: 20 };
    const origin = pageOrigin(viewport, page, clampScroll({ x: -5000, y: 5000 }, viewport, page));
    expect(origin).toEqual({ x: 0, y: viewport.height - 20 });
  });

  it("panBy suma y respeta los límites", () => {
    const view = panBy({ zoom: 1, scroll: { x: 10, y: 0 } }, { x: -30, y: 12 }, viewport, a4);
    expect(view.scroll).toEqual({ x: -20, y: 12 });
  });
});

describe("zoom hacia un punto", () => {
  it("el punto bajo el puntero sigue bajo el puntero, también con la página centrada", () => {
    const point = { x: 430, y: 610 };
    let view = fitView(a4, viewport);
    const target = pageAt(view, point);

    for (const zoom of [0.9, 1.3, 2, 4.4, 8]) {
      view = zoomAround(view, zoom, point, viewport, a4);
      const now = pageAt(view, point);
      expect(now.x).toBeCloseTo(target.x, 6);
      expect(now.y).toBeCloseTo(target.y, 6);
    }
    expect(view.zoom).toBe(8);
  });

  it("alejar también mantiene el punto", () => {
    const point = { x: 900, y: 100 };
    const start = { zoom: 4, scroll: { x: -300, y: 900 } };
    const target = pageAt(start, point);
    const view = zoomAround(start, 1.5, point, viewport, a4);
    expect(pageAt(view, point).x).toBeCloseTo(target.x, 6);
    expect(pageAt(view, point).y).toBeCloseTo(target.y, 6);
  });

  it("hacia el centro del área con la página centrada, sigue centrada", () => {
    const center = { x: viewport.width / 2, y: viewport.height / 2 };
    const view = zoomAround({ zoom: 1, scroll: { x: 0, y: 0 } }, 2, center, viewport, a4);
    expect(view.scroll.x).toBeCloseTo(0, 9);
    expect(view.scroll.y).toBeCloseTo(0, 9);
  });
});

describe("centerOn", () => {
  it("deja el punto pedido en el centro del área, con el mismo zoom", () => {
    const point = { x: 300, y: 500 };
    const view = centerOn(2, point, viewport, a4);
    const center = { x: viewport.width / 2, y: viewport.height / 2 };
    const at = pageAt(view, center);
    expect(view.zoom).toBe(2);
    expect(at.x).toBeCloseTo(point.x, 9);
    expect(at.y).toBeCloseTo(point.y, 9);
  });
});

describe("formatZoom", () => {
  it("redondea al entero y usa espacio fino", () => {
    expect(formatZoom(1)).toBe("100 %");
    expect(formatZoom(0.333)).toBe("33 %");
    expect(formatZoom(8)).toBe("800 %");
  });
});
