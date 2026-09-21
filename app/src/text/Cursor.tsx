/**
 * El cursor de texto, dibujado donde dice Typst.
 *
 * Es lo único que la interfaz pinta dentro de un texto (principio 2), y su
 * sitio sale de las posiciones de los glifos que devuelve el núcleo
 * (`layout::glyphs`), no de medir el texto aquí (principio 3): por eso
 * sigue cuadrando a cualquier zoom y con cualquier fuente.
 *
 * Se coloca como la capa de controles: sobre la caja sin girar del
 * elemento, girada alrededor de su centro, así que en un texto girado el
 * cursor gira con él.
 *
 * # Parpadeo
 *
 * Parpadea, y **deja de parpadear mientras se escribe**: cada tecla
 * reinicia la animación, que empieza con el cursor encendido. Así no se
 * queda invisible justo cuando se mira dónde va a caer la letra.
 */
import type { CanvasTransform } from "../canvas/transform";
import { rectToCanvas } from "../canvas/transform";
import { useEditingStore } from "../store/editing";
import type { LayoutBox } from "../types/layout";
import { caretAt } from "./caret";

export interface CursorProps {
  /** La caja del texto que se está escribiendo, la que midió Typst. */
  box: LayoutBox;
  /** Dónde está la página y a qué escala. */
  transform: CanvasTransform;
  /**
   * Qué página se está viendo, si el texto pasa por varias: de un flujo
   * solo se dibuja aquí lo que quedó en esta.
   */
  page?: number;
}

export function Cursor({ box, transform, page }: CursorProps) {
  const glyphs = useEditingStore((state) => state.glyphs);
  // Se dibuja donde está el extremo que se mueve.
  const end = useEditingStore((state) => state.end);
  const typedAt = useEditingStore((state) => state.typedAt);

  // El cursor sale de todos los glifos, también los de otras páginas: hay
  // que saber dónde cayó de verdad. Lo que no se dibuja es el de una
  // página que no se está viendo.
  const caret = caretAt(glyphs, end);
  if (caret === null || (page !== undefined && caret.page !== page)) {
    return null;
  }

  const rect = rectToCanvas(transform, box);
  const scale = transform.pxPerMm;

  return (
    <div
      className="text-cursor-layer"
      style={{
        width: rect.width,
        height: rect.height,
        transform: `translate(${rect.left}px, ${rect.top}px) rotate(${box.rotation}deg)`,
        transformOrigin: "center",
      }}
    >
      {/* Al cambiar la clave se vuelve a montar, y la animación empieza de
          nuevo: el cursor se queda encendido mientras se teclea. */}
      <span
        key={typedAt}
        className="text-cursor"
        style={{
          left: (caret.x - box.x) * scale,
          top: (caret.y - box.y) * scale,
          height: caret.height * scale,
        }}
      />
    </div>
  );
}
