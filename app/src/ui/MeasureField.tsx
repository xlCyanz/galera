/**
 * Un campo numérico del inspector: se escribe, se ajusta con las flechas o
 * se arrastra en vertical desde su etiqueta.
 *
 * - Enter o salir del campo aplica lo escrito; Esc lo descarta.
 * - ↑/↓ suben o bajan 1 (10 con Shift, 0,1 con Alt) y aplican al momento.
 * - Arrastrar la etiqueta hacia arriba sube el valor y hacia abajo lo baja;
 *   mientras se arrastra solo cambia el número, y al soltar se aplica una
 *   vez: un único paso del historial.
 *
 * El campo no sabe de comandos: avisa con `onCommit` y el valor que enseña
 * es siempre el que le llega, salvo mientras se escribe o se arrastra.
 */
import { type KeyboardEvent, type PointerEvent, useId, useRef, useState } from "react";

import { formatNumber, parseNumber, scrubValue, stepFor } from "./fieldValue";

export interface MeasureFieldProps {
  /** La etiqueta corta: «X», «An», «Giro». */
  label: string;
  /** El nombre completo, para lectores de pantalla y la ayuda. */
  title: string;
  /** El valor actual, o `null` si todavía no se sabe. */
  value: number | null;
  /** «mm» o «°». */
  unit: string;
  /** Solo lectura: se enseña, pero no se edita. */
  readOnly?: boolean;
  /** Lo que se enseña al lado en vez de la unidad, p. ej. «auto». */
  note?: string;
  /** Se ha fijado un valor nuevo. */
  onCommit?: (value: number) => void;
  /**
   * El valor no es el mismo en todos los elementos: el campo sale vacío con
   * «Mixto», y escribir un número lo fija en todos.
   */
  mixed?: boolean;
  /**
   * Cuánto sube un paso: una flecha o unos píxeles de arrastre. Shift lo
   * multiplica por 10 y Alt lo divide entre 10. Por defecto, 1.
   */
  step?: number;
}

export function MeasureField({
  label,
  title,
  value,
  unit,
  readOnly = false,
  note,
  onCommit,
  mixed = false,
  step: baseStep = 1,
}: MeasureFieldProps) {
  const id = useId();
  // Lo que se está escribiendo o arrastrando; `null` si se enseña `value`.
  const [draft, setDraft] = useState<string | null>(null);
  const scrub = useRef<{ start: number; y: number; moved: boolean } | null>(null);
  const shown = draft ?? (value === null ? "" : formatNumber(value));
  const editable = !readOnly && (value !== null || mixed) && onCommit !== undefined;

  const commit = (text: string) => {
    setDraft(null);
    const parsed = parseNumber(text);
    if (parsed !== null && parsed !== value) {
      onCommit?.(parsed);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit(event.currentTarget.value);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setDraft(null);
      event.currentTarget.blur();
    } else if ((event.key === "ArrowUp" || event.key === "ArrowDown") && value !== null) {
      event.preventDefault();
      const base = parseNumber(event.currentTarget.value) ?? value;
      const step = stepFor(event) * baseStep * (event.key === "ArrowUp" ? 1 : -1);
      setDraft(null);
      onCommit?.(Math.round((base + step) * 1000) / 1000 + 0);
    }
  };

  const onScrubStart = (event: PointerEvent<HTMLLabelElement>) => {
    if (!editable || event.button !== 0 || value === null) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    scrub.current = { start: value, y: event.clientY, moved: false };
  };

  const onScrubMove = (event: PointerEvent<HTMLLabelElement>) => {
    const current = scrub.current;
    if (current === null) {
      return;
    }
    const next = scrubValue(current.start, event.clientY - current.y, stepFor(event) * baseStep);
    current.moved ||= next !== current.start;
    setDraft(formatNumber(next));
  };

  const onScrubEnd = (event: PointerEvent<HTMLLabelElement>) => {
    const current = scrub.current;
    scrub.current = null;
    if (current === null) {
      return;
    }
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    const next = scrubValue(current.start, event.clientY - current.y, stepFor(event) * baseStep);
    setDraft(null);
    if (current.moved && next !== current.start) {
      onCommit?.(next);
    }
  };

  return (
    <div className={editable ? "measure-field" : "measure-field is-read-only"}>
      <label
        htmlFor={id}
        title={editable ? `${title}: arrastra en vertical para ajustar` : title}
        onPointerDown={onScrubStart}
        onPointerMove={onScrubMove}
        onPointerUp={onScrubEnd}
        onPointerCancel={() => {
          scrub.current = null;
          setDraft(null);
        }}
      >
        {label}
      </label>
      <input
        id={id}
        aria-label={title}
        inputMode="decimal"
        value={shown}
        placeholder={mixed ? "Mixto" : undefined}
        readOnly={!editable}
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={(event) => {
          if (draft !== null && scrub.current === null) {
            commit(event.currentTarget.value);
          }
        }}
        onKeyDown={editable ? onKeyDown : undefined}
      />
      <span className="measure-unit">{note ?? unit}</span>
    </div>
  );
}
