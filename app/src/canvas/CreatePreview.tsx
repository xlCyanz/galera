/**
 * La forma o el texto que se está creando, antes de que exista (ver
 * `useCreate.ts`). Un texto se ve como una caja de una línea con su ancho:
 * cuánto ocupa de alto lo sabrá Typst al componerlo.
 *
 * Es un dibujo de la interfaz, como el contorno de la selección: una caja,
 * una elipse o una línea con el color de los controles, colocada con
 * `transform.ts`. Lo que se crea de verdad lo dibuja Typst al recompilar.
 */
import { type ShapeGeometry, TEXT_PREVIEW_HEIGHT_MM } from "./createGeometry";
import { type CanvasTransform, rectToCanvas, toCanvas } from "./transform";

export interface CreatePreviewProps {
  shape: ShapeGeometry;
  transform: CanvasTransform;
}

export function CreatePreview({ shape, transform }: CreatePreviewProps) {
  if (shape.kind === "line") {
    const a = toCanvas(transform, shape.x, shape.y);
    const b = toCanvas(transform, shape.x2, shape.y2);
    return (
      <svg className="create-preview is-line" data-shape="line" aria-hidden="true">
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
      </svg>
    );
  }
  const rect = rectToCanvas(
    transform,
    shape.kind === "text" ? { ...shape, h: TEXT_PREVIEW_HEIGHT_MM } : shape,
  );
  return (
    <div
      className="create-preview"
      data-shape={shape.kind}
      aria-hidden="true"
      style={{
        width: rect.width,
        height: rect.height,
        transform: `translate(${rect.left}px, ${rect.top}px)`,
        borderRadius: shape.kind === "ellipse" ? "50%" : 0,
      }}
    />
  );
}
