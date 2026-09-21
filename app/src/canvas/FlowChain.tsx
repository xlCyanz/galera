/**
 * Las zonas enlazadas de un flujo, señaladas en el lienzo.
 *
 * Mientras se escribe un texto que fluye, cada zona de su cadena se marca
 * con un recuadro y con **el número que ocupa en la cadena**: por ahí va el
 * texto, y en ese orden. Sin eso, dos zonas de la misma página no se
 * distinguen de dos bloques de texto sueltos.
 *
 * Solo se dibujan las zonas que quedaron en la página que se ve; las demás
 * están en otra, y el número dice que las hay.
 *
 * Es una ayuda del editor, no parte del documento: no se exporta ni sale en
 * el PDF (principio 2).
 */
import { useDocumentStore } from "../store/document";
import { useLayoutStore } from "../store/layout";
import type { CanvasTransform } from "./transform";
import { rectToCanvas } from "./transform";

export interface FlowChainProps {
  /** El flujo cuya cadena se señala. */
  flow: string;
  /** La página que se está viendo, contando desde 0. */
  page: number;
  /** Dónde está la página y a qué escala. */
  transform: CanvasTransform;
}

export function FlowChain({ flow, page, transform }: FlowChainProps) {
  const zones = useDocumentStore((state) => state.document?.flows?.[flow]?.zones);
  const boxes = useLayoutStore((state) => state.boxes);

  if (zones === undefined || zones.length === 0) {
    return null;
  }

  return (
    <>
      {zones.map((id, order) => {
        const box = boxes[id];
        if (box === undefined || box.page !== page) {
          return null;
        }
        const rect = rectToCanvas(transform, box);
        return (
          <div
            key={id}
            className="flow-zone"
            data-zone={id}
            style={{
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
              transform: `rotate(${box.rotation}deg)`,
            }}
          >
            <span className="flow-zone-order">
              {order + 1} de {zones.length}
            </span>
          </div>
        );
      })}
    </>
  );
}
