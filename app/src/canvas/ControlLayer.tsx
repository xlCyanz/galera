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
import type { LayoutBox } from "../types/layout";
import { BoxHandles, LineHandles } from "./Handles";
import { type CanvasTransform, rectToCanvas } from "./transform";

export interface ControlLayerProps {
  /** La caja del elemento seleccionado, tal como la midió Typst. */
  box: LayoutBox;
  /** Dónde está la página y a qué escala. */
  transform: CanvasTransform;
}

export function ControlLayer({ box, transform }: ControlLayerProps) {
  const rect = rectToCanvas(transform, box);
  const scale = transform.pxPerMm;
  const line = box.line;

  return (
    <div
      className={line === null ? "control-layer" : "control-layer is-line"}
      data-element={box.id}
      style={{
        width: rect.width,
        height: rect.height,
        transform: `translate(${rect.left}px, ${rect.top}px) rotate(${box.rotation}deg)`,
        transformOrigin: "center",
      }}
    >
      {line === null ? (
        <BoxHandles width={rect.width} height={rect.height} rotation={box.rotation} />
      ) : (
        <LineHandles
          start={{ x: (line.x1 - box.x) * scale, y: (line.y1 - box.y) * scale }}
          end={{ x: (line.x2 - box.x) * scale, y: (line.y2 - box.y) * scale }}
        />
      )}
    </div>
  );
}
