/**
 * La capa de controles: lo único que la interfaz dibuja por su cuenta
 * encima del SVG de Typst (principio 2).
 *
 * Para el elemento seleccionado dibuja su contorno y sus manejadores
 * (`Handles.tsx`). El contorno es **la caja que devolvió el layout**, pasada
 * a píxeles con `transform.ts`, así que coincide con lo que dibujó Typst a
 * cualquier zoom. La capa se coloca sobre la caja sin girar y se gira
 * alrededor de su centro, igual que hace Typst con el elemento: contorno y
 * manejadores giran con él.
 */
import type { PointerEvent } from "react";

import type { LayoutBox } from "../types/layout";
import { BoxHandles, LineHandles } from "./Handles";
import type { ResizeHandle } from "./handleGeometry";
import { formatSize } from "./resizeGeometry";
import { formatAngle } from "./rotateGeometry";
import { type CanvasTransform, rectToCanvas } from "./transform";

export interface ControlLayerProps {
  /** La caja del elemento seleccionado, tal como la midió Typst. */
  box: LayoutBox;
  /** Dónde está la página y a qué escala. */
  transform: CanvasTransform;
  /** Cuánto se está arrastrando el elemento, en mm. */
  offset?: { dx: number; dy: number };
  /** Pulsar dentro del contorno (no en un manejador): empezar a arrastrar. */
  onBodyPointerDown?: (event: PointerEvent<HTMLDivElement>) => void;
  /** Pulsar un manejador de redimensionado. */
  onResizeStart?: (handle: ResizeHandle, event: PointerEvent<HTMLElement>) => void;
  /** Pulsar el manejador de rotación. */
  onRotateStart?: (event: PointerEvent<HTMLElement>) => void;
  /** Enseñar las medidas de la caja: durante un redimensionado. */
  showSize?: boolean;
  /** Enseñar el ángulo: durante un giro. */
  showAngle?: boolean;
  /**
   * Si responde al puntero. Con otra herramienta que no sea la de
   * selección, el contorno se ve pero el clic pasa al lienzo.
   */
  interactive?: boolean;
}

export function ControlLayer({
  box,
  transform,
  offset = { dx: 0, dy: 0 },
  onBodyPointerDown,
  onResizeStart,
  onRotateStart,
  showSize = false,
  showAngle = false,
  interactive = true,
}: ControlLayerProps) {
  const rect = rectToCanvas(transform, { ...box, x: box.x + offset.dx, y: box.y + offset.dy });
  const scale = transform.pxPerMm;
  const line = box.line;

  return (
    <div
      className={["control-layer", line === null ? "" : "is-line", interactive ? "" : "is-inert"]
        .filter(Boolean)
        .join(" ")}
      data-element={box.id}
      onPointerDown={line === null ? onBodyPointerDown : undefined}
      style={{
        width: rect.width,
        height: rect.height,
        transform: `translate(${rect.left}px, ${rect.top}px) rotate(${box.rotation}deg)`,
        transformOrigin: "center",
      }}
    >
      {line === null ? (
        <>
          <BoxHandles
            width={rect.width}
            height={rect.height}
            rotation={box.rotation}
            {...(onResizeStart === undefined ? {} : { onResizeStart })}
            {...(onRotateStart === undefined ? {} : { onRotateStart })}
          />
          {showSize && (
            <div className="size-label" role="status">
              {formatSize(box.w, box.h)}
            </div>
          )}
          {showAngle && (
            // La capa está girada: la etiqueta se gira al revés para leerse recta.
            <div
              className="size-label angle-label"
              role="status"
              style={{ transform: `translateX(-50%) rotate(${-box.rotation}deg)` }}
            >
              {formatAngle(box.rotation)}
            </div>
          )}
        </>
      ) : (
        <LineHandles
          start={{ x: (line.x1 - box.x) * scale, y: (line.y1 - box.y) * scale }}
          end={{ x: (line.x2 - box.x) * scale, y: (line.y2 - box.y) * scale }}
        />
      )}
    </div>
  );
}
