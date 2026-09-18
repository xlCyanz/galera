/**
 * Las reglas del lienzo, en milímetros.
 *
 * El 0 de cada regla cae en el borde de la página, y las marcas siguen la
 * misma escala que la página (ver `rulerTicks.ts`). La posición del puntero se
 * marca con una raya en las dos.
 *
 * Son controles de la interfaz, no contenido del documento: sus números los
 * dibuja el navegador sin problema (principio 2).
 */
import { type RefObject, useEffect, useState } from "react";

import type { PixelSize } from "./geometry";
import { RULER_SIZE, rulerTicks, tickLabel } from "./rulerTicks";
import type { CanvasTransform } from "./transform";
import type { Point } from "./zoom";

/** Largo de las marcas, en píxeles. */
const MAJOR_LENGTH = RULER_SIZE;
const MINOR_LENGTH = 5;

export interface RulersProps {
  /** El área del lienzo, para seguir al puntero. */
  viewport: RefObject<HTMLElement | null>;
  /** Dónde está la página y a qué escala: el 0 de las reglas es su esquina. */
  transform: CanvasTransform;
  /** El tamaño del área. */
  size: PixelSize;
}

/** Las dos reglas y la esquina donde se cruzan. */
export function Rulers({ viewport, transform, size }: RulersProps) {
  const pointer = usePointerIn(viewport);
  const { origin, pxPerMm } = transform;

  return (
    <>
      <div className="ruler-corner" aria-hidden="true" />
      <Ruler
        orientation="horizontal"
        origin={origin.x}
        pxPerMm={pxPerMm}
        length={size.width}
        pointer={pointer?.x ?? null}
      />
      <Ruler
        orientation="vertical"
        origin={origin.y}
        pxPerMm={pxPerMm}
        length={size.height}
        pointer={pointer?.y ?? null}
      />
    </>
  );
}

interface RulerProps {
  orientation: "horizontal" | "vertical";
  origin: number;
  pxPerMm: number;
  length: number;
  pointer: number | null;
}

function Ruler({ orientation, origin, pxPerMm, length, pointer }: RulerProps) {
  const horizontal = orientation === "horizontal";
  const ticks = rulerTicks(origin, pxPerMm, length);

  // Todo se dibuja como si la regla fuera horizontal; la vertical es la
  // misma, girada: su eje «a lo largo» es el vertical.
  const line = (along: number, from: number, to: number) => {
    // Medio píxel para que una raya de 1 px caiga en un píxel entero.
    const at = Math.round(along) + 0.5;
    return horizontal
      ? { x1: at, x2: at, y1: from, y2: to }
      : { x1: from, x2: to, y1: at, y2: at };
  };

  return (
    <svg
      className={`ruler ruler-${orientation}`}
      width={horizontal ? length : RULER_SIZE}
      height={horizontal ? RULER_SIZE : length}
      aria-hidden="true"
      data-origin={origin}
    >
      {ticks.map((tick) => (
        <line
          key={tick.mm}
          className={tick.major ? "ruler-tick-major" : "ruler-tick-minor"}
          data-mm={tick.mm}
          {...line(tick.position, RULER_SIZE - (tick.major ? MAJOR_LENGTH : MINOR_LENGTH), RULER_SIZE)}
        />
      ))}
      {ticks
        .filter((tick) => tick.major)
        .map((tick) =>
          horizontal ? (
            <text key={tick.mm} x={Math.round(tick.position) + 3} y={9}>
              {tickLabel(tick.mm)}
            </text>
          ) : (
            <text
              key={tick.mm}
              transform={`translate(9 ${Math.round(tick.position) - 3}) rotate(-90)`}
            >
              {tickLabel(tick.mm)}
            </text>
          ),
        )}
      {pointer !== null && (
        <line className="ruler-pointer" {...line(pointer, 0, RULER_SIZE)} />
      )}
    </svg>
  );
}

/** Dónde está el puntero dentro de un elemento, o `null` si está fuera. */
function usePointerIn(element: RefObject<HTMLElement | null>): Point | null {
  const [pointer, setPointer] = useState<Point | null>(null);

  useEffect(() => {
    const target = element.current;
    if (target === null) {
      return;
    }
    const move = (event: MouseEvent) => {
      const rect = target.getBoundingClientRect();
      setPointer({ x: event.clientX - rect.left, y: event.clientY - rect.top });
    };
    const leave = () => setPointer(null);
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerleave", leave);
    return () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerleave", leave);
    };
  }, [element]);

  return pointer;
}
