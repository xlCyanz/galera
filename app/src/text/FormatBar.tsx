/**
 * La barra flotante del formato del texto: negrita, cursiva, subrayado y
 * color.
 *
 * Sale sobre lo que está seleccionado y enseña **el formato de esa
 * selección**: un botón se ve activo si todo lo elegido lo lleva, y el
 * color sale como mezclado si los tramos no llevan el mismo. Pulsar aplica
 * o quita, igual que ⌘B, ⌘I y ⌘U.
 *
 * Repartir los tramos lo hace el núcleo (`Op::FormatText`): aquí solo se
 * dice qué cambia y en qué tramo del texto.
 *
 * La barra no gira con el elemento: un rótulo girado no se lee. Se coloca
 * encima de la primera línea de la selección.
 */
import { toCanvas, type CanvasTransform } from "../canvas/transform";
import { useEditingStore } from "../store/editing";
import { ColorPicker } from "../ui/ColorPicker";
import type { Run } from "../types/model";
import type { Format } from "../types/ops";
import { type RunFormat, formatOf, toggle } from "./format";
import { selectionRects } from "./selection";

/** Lo que la barra ocupa de alto, en píxeles: se coloca justo encima. */
const HEIGHT = 34;

export interface FormatBarProps {
  /** Los tramos del texto que se escribe. */
  runs: readonly Run[];
  /** Dónde está la página y a qué escala. */
  transform: CanvasTransform;
  /** Aplica un cambio de formato a lo seleccionado. */
  onFormat: (change: Format) => void;
}

export function FormatBar({ runs, transform, onFormat }: FormatBarProps) {
  const glyphs = useEditingStore((state) => state.glyphs);
  const start = useEditingStore((state) => state.start);
  const end = useEditingStore((state) => state.end);

  const rects = selectionRects(glyphs, start, end);
  const first = rects[0];
  if (first === undefined) {
    return null;
  }

  const format = formatOf(runs, start, end);
  const at = toCanvas(transform, first.x, first.y);

  return (
    <div
      className="format-bar"
      role="toolbar"
      aria-label="Formato del texto"
      style={{ left: at.x, top: at.y - HEIGHT }}
      // Pulsar la barra no es pulsar el lienzo: no cambia la selección.
      onPointerDown={(event) => event.stopPropagation()}
    >
      {(["bold", "italic", "underline"] as const).map((what) => (
        <button
          key={what}
          type="button"
          className={`format-button${format[what] ? " is-on" : ""}`}
          aria-label={LABELS[what]}
          aria-pressed={format[what]}
          title={LABELS[what]}
          onClick={() => onFormat(toggle(format, what))}
        >
          {MARKS[what]}
        </button>
      ))}
      <ColorPicker
        label="Color del texto"
        value={format.color}
        allowNone
        onCommit={(color) => onFormat({ color })}
      />
    </div>
  );
}

const LABELS: Record<keyof Omit<RunFormat, "color">, string> = {
  bold: "Negrita",
  italic: "Cursiva",
  underline: "Subrayado",
};

const MARKS: Record<keyof Omit<RunFormat, "color">, string> = {
  bold: "B",
  italic: "I",
  underline: "U",
};
