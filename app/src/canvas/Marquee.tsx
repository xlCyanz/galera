/**
 * El rectángulo de selección que se arrastra por el lienzo
 * (`useMarquee.ts`).
 *
 * Es un dibujo de la interfaz, en la capa de controles y nunca dentro del
 * SVG de Typst (principio 2). Se puede arrastrar en cualquier dirección: el
 * rectángulo se normaliza antes de dibujarlo.
 */
import type { MmRect } from "../types/layout";
import { type CanvasTransform, rectToCanvas } from "./transform";

export interface MarqueeProps {
  /** El rectángulo, en mm de la página; el ancho y el alto pueden ser negativos. */
  rect: MmRect;
  /** Dónde está la página y a qué escala. */
  transform: CanvasTransform;
}

export function Marquee({ rect, transform }: MarqueeProps) {
  const area = rectToCanvas(transform, {
    x: Math.min(rect.x, rect.x + rect.w),
    y: Math.min(rect.y, rect.y + rect.h),
    w: Math.abs(rect.w),
    h: Math.abs(rect.h),
  });
  return (
    <div
      className="marquee"
      aria-hidden="true"
      style={{
        width: area.width,
        height: area.height,
        transform: `translate(${area.left}px, ${area.top}px)`,
      }}
    />
  );
}
