/**
 * Las guías del ajuste, mientras se mueve o se redimensiona un elemento.
 *
 * Se dibujan en la capa de controles, encima del SVG de Typst y nunca
 * dentro de él (principio 2): son una ayuda de la interfaz, no parte del
 * documento, y no salen en el PDF.
 *
 * Dónde va cada una lo dice el núcleo, en milímetros de la página
 * (`galera_core::snap`); aquí solo se pasan a píxeles con la misma
 * transformación que todo lo demás del lienzo.
 *
 * - Las de **alineación** van de punta a punta de lo que alinean.
 * - Las de **espaciado** recorren el hueco que miden, con una marca en cada
 *   extremo y la distancia en milímetros al lado: es lo que hay entre los
 *   elementos.
 */
import type { CanvasTransform } from "./transform";
import { formatDistance, guideInPx, guideLength } from "./snapping";
import type { Guide } from "../types/snap";

/** Cuánto sobresale la marca en los extremos de un espaciado, en píxeles. */
const CAP_PX = 4;

export interface GuidesProps {
  /** Las guías que devolvió el núcleo, en mm de la página. */
  guides: Guide[];
  /** Dónde está la página y a qué escala. */
  transform: CanvasTransform;
}

export function Guides({ guides, transform }: GuidesProps) {
  if (guides.length === 0) {
    return null;
  }
  return (
    <svg className="snap-guides" aria-hidden="true">
      {guides.map((guide, index) => {
        const line = guideInPx(transform, guide);
        // La marca de los extremos va cruzada al hueco que mide.
        const horizontal = Math.abs(line.y2 - line.y1) < Math.abs(line.x2 - line.x1);
        const cap = horizontal ? { x: 0, y: CAP_PX } : { x: CAP_PX, y: 0 };
        return (
          <g className={`snap-guide is-${guide.kind}`} key={`${guide.kind}-${index}`}>
            <line x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} />
            {guide.kind === "spacing" && (
              <>
                <line
                  x1={line.x1 - cap.x}
                  y1={line.y1 - cap.y}
                  x2={line.x1 + cap.x}
                  y2={line.y1 + cap.y}
                />
                <line
                  x1={line.x2 - cap.x}
                  y1={line.y2 - cap.y}
                  x2={line.x2 + cap.x}
                  y2={line.y2 + cap.y}
                />
                <text
                  className="snap-distance"
                  x={(line.x1 + line.x2) / 2}
                  y={(line.y1 + line.y2) / 2 - CAP_PX}
                  textAnchor="middle"
                >
                  {formatDistance(guideLength(guide))}
                </text>
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}
