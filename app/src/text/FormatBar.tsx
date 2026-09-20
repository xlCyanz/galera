/**
 * La barra flotante del formato del texto: negrita, cursiva, subrayado y
 * color.
 *
 * Sale sobre lo que está seleccionado y enseña **el formato de esa
 * selección**: un botón se ve activo si todo lo elegido lo lleva, y el
 * color sale como mezclado si los tramos no llevan el mismo. Pulsar aplica
 * o quita, igual que ⌘B, ⌘I y ⌘U.
 *
 * El botón del enlace abre un campo con el destino de lo seleccionado:
 * escribir uno lo pone, vaciarlo lo quita. Lo que no lleve a la web o al
 * correo lo rechaza el núcleo, y aquí se dice.
 *
 * Repartir los tramos lo hace el núcleo (`Op::FormatText`): aquí solo se
 * dice qué cambia y en qué tramo del texto.
 *
 * La barra no gira con el elemento: un rótulo girado no se lee. Se coloca
 * encima de la primera línea de la selección.
 */
import { useState } from "react";

import { toCanvas, type CanvasTransform } from "../canvas/transform";
import { useEditingStore } from "../store/editing";
import { ColorPicker } from "../ui/ColorPicker";
import type { Run } from "../types/model";
import type { Format } from "../types/ops";
import type { Line, ListKind, Run as ModelRun } from "../types/model";
import { formatOf, toggle } from "./format";
import { listOf, toggleList } from "./lines";
import { selectionRects } from "./selection";

/** Lo que la barra ocupa de alto, en píxeles: se coloca justo encima. */
const HEIGHT = 34;

export interface FormatBarProps {
  /** Los tramos del texto que se escribe. */
  runs: readonly Run[];
  /** Cómo se compone cada línea del texto que se escribe. */
  lines: readonly Line[];
  /** Dónde está la página y a qué escala. */
  transform: CanvasTransform;
  /** Aplica un cambio de formato a lo seleccionado. Devuelve el problema
   * si el núcleo no lo acepta. */
  onFormat: (change: Format) => Promise<string | null>;
  /** Cambia cómo se componen las líneas que toca la selección. */
  onLines: (style: Line) => Promise<string | null>;
}

export function FormatBar({ runs, lines, transform, onFormat, onLines }: FormatBarProps) {
  const glyphs = useEditingStore((state) => state.glyphs);
  const start = useEditingStore((state) => state.start);
  const end = useEditingStore((state) => state.end);
  /** El destino que se está escribiendo, o `null` si el campo está cerrado. */
  const [target, setTarget] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const rects = selectionRects(glyphs, start, end);
  const first = rects[0];
  if (first === undefined) {
    return null;
  }

  const format = formatOf(runs, start, end);
  const text = runs.map((run: ModelRun) => run.text).join("");
  const list = listOf(text, lines, start, end);
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
          onClick={() => void onFormat(toggle(format, what))}
        >
          {MARKS[what]}
        </button>
      ))}
      {(["bullet", "numbered"] as const).map((kind) => (
        <button
          key={kind}
          type="button"
          className={`format-button${list === kind ? " is-on" : ""}`}
          aria-label={LISTS[kind]}
          aria-pressed={list === kind}
          title={LISTS[kind]}
          onClick={() => void onLines(toggleList(text, lines, start, end, kind))}
        >
          {kind === "bullet" ? "•" : "1."}
        </button>
      ))}
      <ColorPicker
        label="Color del texto"
        value={format.color}
        allowNone
        onCommit={(color) => void onFormat({ color })}
      />
      <button
        type="button"
        className={`format-button${format.link === null ? "" : " is-on"}`}
        aria-label="Enlace"
        aria-pressed={format.link !== null}
        title="Enlace"
        onClick={() => {
          setProblem(null);
          setTarget(target === null ? (typeof format.link === "string" ? format.link : "") : null);
        }}
      >
        ↗
      </button>
      {target !== null && (
        <input
          className="format-link"
          aria-label="Destino del enlace"
          placeholder="https://"
          value={target}
          autoFocus
          onChange={(event) => setTarget(event.currentTarget.value)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") {
              setTarget(null);
              setProblem(null);
            } else if (event.key === "Enter") {
              const link = target.trim();
              void onFormat({ link: link === "" ? null : link }).then((refused) => {
                setProblem(refused);
                if (refused === null) {
                  setTarget(null);
                }
              });
            }
          }}
        />
      )}
      {problem !== null && (
        <p className="format-problem" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}

/** Los tres que se ponen y se quitan con un botón. */
type Toggleable = "bold" | "italic" | "underline";

const LABELS: Record<Toggleable, string> = {
  bold: "Negrita",
  italic: "Cursiva",
  underline: "Subrayado",
};

const LISTS: Record<ListKind, string> = {
  bullet: "Lista con viñetas",
  numbered: "Lista numerada",
};

const MARKS: Record<Toggleable, string> = {
  bold: "B",
  italic: "I",
  underline: "U",
};
