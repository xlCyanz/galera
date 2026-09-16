/**
 * Las marcas de las reglas, sin DOM.
 *
 * Las reglas miden en milímetros desde la esquina superior izquierda de la
 * página, a la misma escala que el lienzo (`PX_PER_MM × zoom`). Las marcas se
 * espacian según el zoom: se elige el paso más pequeño cuyas marcas mayores
 * quedan al menos a `MIN_MAJOR_SPACING` píxeles, y las menores se dibujan
 * solo si caben.
 */

/** Grosor de cada regla, en píxeles CSS. */
export const RULER_SIZE = 20;

/** Distancia mínima entre marcas mayores, para que quepan los números. */
export const MIN_MAJOR_SPACING = 64;

/** Distancia mínima entre marcas menores. */
export const MIN_MINOR_SPACING = 4;

/** Pasos posibles, en mm: la marca mayor y la menor. */
const STEPS: ReadonlyArray<readonly [major: number, minor: number]> = [
  [1, 0.5],
  [2, 1],
  [5, 1],
  [10, 1],
  [20, 5],
  [50, 10],
  [100, 10],
  [200, 50],
  [500, 100],
  [1000, 100],
];

export interface RulerStep {
  major: number;
  minor: number;
}

/** El paso de las marcas para una escala, en píxeles por milímetro. */
export function rulerStep(pxPerMm: number): RulerStep {
  const found = STEPS.find(([major]) => major * pxPerMm >= MIN_MAJOR_SPACING) ?? STEPS.at(-1)!;
  return { major: found[0], minor: found[1] };
}

export interface Tick {
  /** Posición a lo largo de la regla, en píxeles desde su inicio. */
  position: number;
  /** Qué milímetro marca, desde el borde de la página. */
  mm: number;
  major: boolean;
}

/**
 * Las marcas visibles de una regla.
 *
 * @param origin Dónde está el borde de la página a lo largo de la regla, en
 *   píxeles desde su inicio.
 * @param pxPerMm La escala.
 * @param length Cuánto mide la regla, en píxeles.
 */
export function rulerTicks(origin: number, pxPerMm: number, length: number): Tick[] {
  if (!(pxPerMm > 0) || !(length > 0)) {
    return [];
  }
  const { major, minor } = rulerStep(pxPerMm);
  const drawMinor = minor * pxPerMm >= MIN_MINOR_SPACING;
  const step = drawMinor ? minor : major;
  const ratio = Math.round(major / step);

  // Contar marcas con enteros evita que 0,1 + 0,2 deje de caer en su sitio.
  const first = Math.ceil(-origin / pxPerMm / step);
  const last = Math.floor((length - origin) / pxPerMm / step);

  const ticks: Tick[] = [];
  for (let index = first; index <= last; index++) {
    // `+ 0` convierte -0 en 0.
    const mm = index * step + 0;
    ticks.push({ position: origin + mm * pxPerMm, mm, major: index % ratio === 0 });
  }
  return ticks;
}

/** El milímetro de la página que queda en una posición de la regla. */
export function mmAt(position: number, origin: number, pxPerMm: number): number {
  return (position - origin) / pxPerMm;
}

/** Cómo se escribe el número de una marca mayor. */
export function tickLabel(mm: number): string {
  // `+ 0` convierte -0 en 0.
  return String(Math.round(mm * 10) / 10 + 0);
}
