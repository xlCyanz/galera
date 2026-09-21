/**
 * La lista de variables que sale al escribir `{{` dentro de un texto.
 *
 * Elegir una deja la ficha puesta —`{{nombre}}`— y el cursor detrás. La
 * ficha se ve en la página con el valor de la variable, porque el núcleo la
 * sustituye al generar el código; aquí solo se escribe su nombre.
 *
 * - Se filtra con lo que se lleve escrito tras las llaves.
 * - ↑ y ↓ mueven por la lista, Enter o Tab ponen la ficha, Esc cierra.
 * - Sin variables que encajen no sale nada: lo tecleado sigue siendo texto.
 */
import { useEffect, useState } from "react";

import type { CanvasTransform } from "../canvas/transform";
import { toCanvas } from "../canvas/transform";
import { useOpenDocument } from "../store/document";
import { useEditingStore } from "../store/editing";
import type { LayoutBox } from "../types/layout";
import { caretAt, textIndex } from "./caret";
import { openChip, withChip } from "./chips";

export interface ChipPickerProps {
  /** El texto que se está escribiendo, tal como está en el documento. */
  text: string;
  /** Su caja, para colocar la lista donde está el cursor. */
  box: LayoutBox;
  /** Dónde está la página y a qué escala. */
  transform: CanvasTransform;
}

export function ChipPicker({ text, box, transform }: ChipPickerProps) {
  const document = useOpenDocument();
  const start = useEditingStore((state) => state.start);
  const end = useEditingStore((state) => state.end);
  const glyphs = useEditingStore((state) => state.glyphs);
  const [highlighted, setHighlighted] = useState(0);

  // Lo que se lleva escrito tras el `{{`, contado en unidades del campo.
  const at = start === end ? textIndex(text, start) : null;
  const open = at === null ? null : openChip(text, at);
  const names = Object.keys(document?.variables ?? {}).filter((name) =>
    name.toLowerCase().startsWith((open?.prefix ?? "").toLowerCase()),
  );

  useEffect(() => {
    setHighlighted(0);
  }, [open?.prefix]);

  useEffect(() => {
    if (open === null || names.length === 0) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        setHighlighted((current) => {
          const next = current + (event.key === "ArrowDown" ? 1 : -1);
          return (next + names.length) % names.length;
        });
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        const name = names[highlighted];
        if (name !== undefined) {
          event.preventDefault();
          event.stopPropagation();
          insert(open.from, at ?? open.from, name);
        }
      }
    };
    // En captura: antes de que el campo invisible lo trate como texto.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open?.from, open?.prefix, names.join(","), highlighted, at, text]);

  if (open === null || names.length === 0) {
    return null;
  }

  // Donde está el cursor, para poner la lista justo debajo.
  const caret = caretAt(glyphs, start);
  const point = toCanvas(
    transform,
    box.x + (caret?.x ?? 0),
    box.y + (caret?.y ?? 0) + (caret?.height ?? 0),
  );

  return (
    <ul
      className="chip-picker"
      role="listbox"
      aria-label="Variables"
      style={{ transform: `translate(${point.x}px, ${point.y}px)` }}
    >
      {names.map((name, index) => (
        <li key={name}>
          <button
            type="button"
            role="option"
            aria-selected={index === highlighted}
            className={index === highlighted ? "is-highlighted" : ""}
            onMouseEnter={() => setHighlighted(index)}
            // El puntero no puede quitarle el foco al campo invisible.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => insert(open.from, at ?? open.from, name)}
          >
            {name}
            <span className="chip-value">{document?.variables[name]?.value || "sin valor"}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Pone la ficha en el texto que se escribe, en vez de lo tecleado. */
function insert(from: number, to: number, name: string): void {
  const { text: chip } = withChip("", 0, 0, name);
  useEditingStore.getState().requestInsert(chip, from, to);
}
