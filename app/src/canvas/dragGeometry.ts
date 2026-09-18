/**
 * Cálculos del arrastre, sin DOM: cuánto se ha movido un elemento en mm y
 * cómo lo mueven las flechas.
 */

/**
 * Redondea una medida al micrómetro antes de guardarla en el documento: sin
 * esto, pasar de píxeles a mm deja números como 60,000000000000014 en el
 * JSON. Un micrómetro no se ve ni al 800 % (0,03 px).
 */
export function roundMm(value: number): number {
  return Math.round(value * 1000) / 1000 + 0;
}

/** Un desplazamiento en mm. */
export interface Delta {
  dx: number;
  dy: number;
}

/**
 * Cuánto se ha arrastrado, en mm de la página, desde `start` hasta `current`
 * (píxeles de pantalla) con la escala del lienzo.
 *
 * Con `constrain` (Shift), el movimiento se queda en el eje en el que se ha
 * movido más: horizontal o vertical.
 */
export function dragDelta(
  start: { x: number; y: number },
  current: { x: number; y: number },
  pxPerMm: number,
  constrain: boolean,
): Delta {
  let dx = (current.x - start.x) / pxPerMm;
  let dy = (current.y - start.y) / pxPerMm;
  if (constrain) {
    if (Math.abs(dx) >= Math.abs(dy)) {
      dy = 0;
    } else {
      dx = 0;
    }
  }
  return { dx: dx + 0, dy: dy + 0 };
}

/** Si un arrastre no ha movido nada: soltar entonces no es un cambio. */
export function isStill(delta: Delta): boolean {
  return delta.dx === 0 && delta.dy === 0;
}

/** Milímetros que mueve una flecha, y con Shift. */
export const NUDGE_MM = 1;
export const BIG_NUDGE_MM = 10;

/**
 * Lo que mueve una tecla de flecha: 1 mm, o 10 mm con Shift. `null` si la
 * tecla no es una flecha o lleva otro modificador.
 */
export function arrowNudge(event: {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
}): Delta | null {
  if (event.altKey || event.metaKey || event.ctrlKey) {
    return null;
  }
  const step = event.shiftKey ? BIG_NUDGE_MM : NUDGE_MM;
  switch (event.key) {
    case "ArrowLeft":
      return { dx: -step, dy: 0 };
    case "ArrowRight":
      return { dx: step, dy: 0 };
    case "ArrowUp":
      return { dx: 0, dy: -step };
    case "ArrowDown":
      return { dx: 0, dy: step };
    default:
      return null;
  }
}

/**
 * Las cuatro esquinas de una caja girada `rotation` grados en sentido
 * horario alrededor de su centro, en las mismas unidades que la caja.
 * En orden: arriba a la izquierda, arriba a la derecha, abajo a la derecha,
 * abajo a la izquierda (sin girar).
 */
export function rotatedCorners(
  box: { x: number; y: number; w: number; h: number },
  rotation: number,
): Array<{ x: number; y: number }> {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const angle = (rotation * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [
    { x: box.x, y: box.y },
    { x: box.x + box.w, y: box.y },
    { x: box.x + box.w, y: box.y + box.h },
    { x: box.x, y: box.y + box.h },
  ].map(({ x, y }) => {
    const dx = x - cx;
    const dy = y - cy;
    // Con el eje y hacia abajo, un ángulo positivo gira en sentido horario.
    return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
  });
}

/**
 * Tiempo sin empujar tras el que el siguiente empujón con las flechas es un
 * paso nuevo del historial, en ms.
 */
export const NUDGE_GROUP_MS = 1000;

/** Una ráfaga de empujones con las flechas: un único paso del historial. */
export interface NudgeBurst {
  /** El grupo con el que se mandan al backend. */
  group: string;
  /** El elemento empujado. */
  id: string;
  /** Cuándo fue el último empujón, en ms. */
  at: number;
}

let bursts = 0;

/**
 * La ráfaga a la que pertenece un empujón a `id` en el instante `now`: la
 * misma que `previous` si es el mismo elemento y no ha pasado
 * `NUDGE_GROUP_MS` desde el último, y si no, una nueva.
 */
export function nudgeBurst(previous: NudgeBurst | null, id: string, now: number): NudgeBurst {
  if (previous !== null && previous.id === id && now - previous.at <= NUDGE_GROUP_MS) {
    return { ...previous, at: now };
  }
  bursts += 1;
  return { group: `nudge-${id}-${bursts}`, id, at: now };
}
