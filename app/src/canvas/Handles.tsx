/**
 * Los manejadores del elemento seleccionado: ocho para redimensionar y uno
 * para girar, o uno en cada extremo si es una línea.
 *
 * Van dentro de la capa de controles, que ya está girada con el elemento:
 * aquí se colocan en píxeles sobre la caja sin girar, y el giro lo pone la
 * capa. Miden siempre `HANDLE_SIZE` píxeles, a cualquier zoom.
 *
 * Los ocho de redimensionado avisan con `onResizeStart` (ver `useResize.ts`);
 * el de rotación y los extremos de una línea, todavía no hacen nada. Pulsar
 * cualquiera no llega al lienzo, así que no deselecciona el elemento.
 */
import type { PointerEvent } from "react";

import {
  HANDLE_POSITION,
  HANDLE_SIZE,
  RESIZE_HANDLES,
  ROTATE_HANDLE_OFFSET,
  type ResizeHandle,
  resizeCursor,
} from "./handleGeometry";

/** Un manejador no deja que el clic llegue al lienzo (ni seleccione). */
function keepFromCanvas(event: PointerEvent<HTMLElement>) {
  event.stopPropagation();
  event.preventDefault();
}

/** Estilo de un manejador centrado en `(x, y)` de la capa. */
function at(x: number, y: number) {
  return {
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
    left: x - HANDLE_SIZE / 2,
    top: y - HANDLE_SIZE / 2,
  };
}

export interface BoxHandlesProps {
  /** Ancho y alto de la caja en pantalla, en píxeles. */
  width: number;
  height: number;
  /** El giro del elemento, para elegir los cursores. */
  rotation: number;
  /** Se ha pulsado un manejador de redimensionado. */
  onResizeStart?: (handle: ResizeHandle, event: PointerEvent<HTMLElement>) => void;
}

/** Los ocho de redimensionado y el de rotación, por encima del borde superior. */
export function BoxHandles({ width, height, rotation, onResizeStart }: BoxHandlesProps) {
  return (
    <>
      <div
        className="rotate-stem"
        style={{ left: width / 2, top: -ROTATE_HANDLE_OFFSET, height: ROTATE_HANDLE_OFFSET }}
      />
      <div
        className="handle rotate-handle"
        data-handle="rotate"
        style={{ ...at(width / 2, -ROTATE_HANDLE_OFFSET), cursor: "grab" }}
        onPointerDown={keepFromCanvas}
      />
      {RESIZE_HANDLES.map((handle) => {
        const position = HANDLE_POSITION[handle];
        return (
          <div
            key={handle}
            className="handle"
            data-handle={handle}
            style={{
              ...at(position.x * width, position.y * height),
              cursor: resizeCursor(handle, rotation),
            }}
            onPointerDown={(event) => {
              keepFromCanvas(event);
              if (event.button === 0) {
                onResizeStart?.(handle, event);
              }
            }}
          />
        );
      })}
    </>
  );
}

export interface LineHandlesProps {
  /** Los dos extremos, en píxeles de la capa. */
  start: { x: number; y: number };
  end: { x: number; y: number };
}

/** Un manejador en cada extremo de una línea. */
export function LineHandles({ start, end }: LineHandlesProps) {
  return (
    <>
      {(
        [
          ["start", start],
          ["end", end],
        ] as const
      ).map(([name, point]) => (
        <div
          key={name}
          className="handle"
          data-handle={name}
          style={{ ...at(point.x, point.y), cursor: "move" }}
          onPointerDown={keepFromCanvas}
        />
      ))}
    </>
  );
}
