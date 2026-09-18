/**
 * La copia del elemento que se ve mientras se arrastra o se gira: el render
 * de la página ya pintado, recortado a la forma de la caja del elemento
 * (girada si lo está) y desplazado o girado sobre su centro.
 *
 * No es un dibujo de la interfaz: son los píxeles que dibujó Typst, movidos
 * (principio 2). El original sigue en su sitio debajo hasta que se
 * recompila. Dentro de la caja va también lo que haya de la página (el
 * fondo blanco, por ejemplo): es un trozo del render, no el elemento suelto.
 */
import type { PixelRect } from "./transform";

export interface DragGhostProps {
  /** La imagen de la página que se está enseñando. */
  url: string;
  /** Dónde está la hoja en el área, en píxeles. */
  sheet: PixelRect;
  /** Las esquinas de la caja del elemento en el área, en píxeles. */
  corners: Array<{ x: number; y: number }>;
  /** Cuánto se ha movido, en píxeles. */
  offset?: { x: number; y: number };
  /** Cuánto se ha girado, en grados en sentido horario, y alrededor de qué punto del área. */
  turn?: { degrees: number; pivot: { x: number; y: number } };
}

export function DragGhost({ url, sheet, corners, offset = { x: 0, y: 0 }, turn }: DragGhostProps) {
  // El recorte, relativo a la esquina de la imagen de la hoja.
  const polygon = corners
    .map(({ x, y }) => `${x - sheet.left}px ${y - sheet.top}px`)
    .join(", ");

  return (
    <img
      className="drag-ghost"
      src={url}
      alt=""
      draggable={false}
      style={{
        width: sheet.width,
        height: sheet.height,
        transform: `translate(${sheet.left + offset.x}px, ${sheet.top + offset.y}px)${
          turn === undefined ? "" : ` rotate(${turn.degrees}deg)`
        }`,
        ...(turn === undefined
          ? {}
          : { transformOrigin: `${turn.pivot.x - sheet.left}px ${turn.pivot.y - sheet.top}px` }),
        clipPath: `polygon(${polygon})`,
      }}
    />
  );
}
