/**
 * El selector de color del inspector: una muestra que abre un panel con
 * rueda (tono y saturación), brillo, opacidad, campo hexadecimal y los
 * colores usados hace poco. Las cuentas están en `colorMath.ts`.
 *
 * Mientras se arrastra en la rueda o en una barra solo cambia la vista del
 * panel; el color se aplica al soltar, al pulsar Enter en el campo o al
 * elegir una muestra: un solo cambio del documento cada vez.
 */
import { type PointerEvent, useEffect, useRef, useState } from "react";

import { useDialogFocus } from "../hooks/useDialogFocus";
import { useRecentColors } from "../store/recentColors";
import { type Hsv, formatColor, hsToWheel, hsvToRgb, parseColor, rgbToHsv, wheelToHs } from "./colorMath";
import { MIXED, type Mixed } from "./shapeFields";

/** Radio de la rueda, en píxeles. */
const WHEEL_RADIUS = 70;

/** Tamaño aproximado del panel, para colocarlo dentro de la ventana. */
const POPOVER = { width: 172, height: 340 };

/**
 * Dónde abrir el panel: bajo la muestra y alineado a su derecha, o encima
 * si no cabe debajo; siempre dentro de la ventana. Va en posición fija para
 * que no lo recorte el scroll del inspector.
 */
function popoverAt(anchor: DOMRect): { top: number; left: number } {
  const margin = 8;
  const below = anchor.bottom + 4;
  const top =
    below + POPOVER.height > window.innerHeight - margin ? Math.max(margin, anchor.top - 4 - POPOVER.height) : below;
  const left = Math.min(Math.max(margin, anchor.right - POPOVER.width), window.innerWidth - POPOVER.width - margin);
  return { top, left };
}

export interface ColorPickerProps {
  /** Para qué es: «Relleno», «Borde». */
  label: string;
  /** El color de ahora, `null` si no hay, o `MIXED`. */
  value: string | null | Mixed;
  /** Si se puede quitar el color del todo. */
  allowNone?: boolean;
  /** Se ha elegido un color, o `null` para ninguno. */
  onCommit: (color: string | null) => void;
}

interface Draft {
  hsv: Hsv;
  alpha: number;
  hex: string;
}

function draftOf(color: string | null | Mixed): Draft {
  const rgba = (typeof color === "string" ? parseColor(color) : null) ?? { r: 31, g: 39, b: 51, a: 1 };
  return { hsv: rgbToHsv(rgba), alpha: rgba.a, hex: formatColor(rgba) };
}

function hexOf(hsv: Hsv, alpha: number): string {
  return formatColor(hsvToRgb(hsv, alpha));
}

export function ColorPicker({ label, value, allowNone = false, onCommit }: ColorPickerProps) {
  const [open, setOpen] = useState<{ top: number; left: number } | null>(null);
  const [draft, setDraft] = useState<Draft>(() => draftOf(value));
  const recent = useRecentColors((state) => state.colors);
  const root = useRef<HTMLDivElement>(null);
  const wheel = useRef<HTMLDivElement>(null);

  // Cerrar al pulsar fuera. Esc, el foco y el tabulador los lleva
  // `useDialogFocus`: al cerrar, el foco vuelve a la muestra de color.
  const isOpen = open !== null;
  const popover = useRef<HTMLDivElement>(null);
  useDialogFocus(popover, { active: isOpen, onEscape: () => setOpen(null) });
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const outside = (event: globalThis.PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(null);
      }
    };
    window.addEventListener("pointerdown", outside, true);
    return () => window.removeEventListener("pointerdown", outside, true);
  }, [isOpen]);

  const commit = (color: string | null) => {
    if (color !== null) {
      useRecentColors.getState().use(color);
    }
    onCommit(color);
  };

  const update = (hsv: Hsv, alpha: number) => setDraft({ hsv, alpha, hex: hexOf(hsv, alpha) });

  const fromWheel = (event: PointerEvent<HTMLDivElement>) => {
    const area = wheel.current?.getBoundingClientRect();
    if (area === undefined) {
      return draft.hsv;
    }
    const { h, s } = wheelToHs(
      event.clientX - (area.left + area.width / 2),
      event.clientY - (area.top + area.height / 2),
      area.width / 2 || WHEEL_RADIUS,
    );
    return { ...draft.hsv, h, s };
  };

  const marker = hsToWheel(draft.hsv.h, draft.hsv.s, WHEEL_RADIUS);
  const shown = typeof value === "string" ? value : null;

  return (
    <div className="color-picker" ref={root}>
      <button
        type="button"
        className="color-swatch"
        aria-label={`${label}: ${value === MIXED ? "mixto" : (shown ?? "ninguno")}`}
        aria-expanded={isOpen}
        onClick={(event) => {
          setDraft(draftOf(value));
          setOpen(isOpen ? null : popoverAt(event.currentTarget.getBoundingClientRect()));
        }}
      >
        <span className="color-chip" style={shown === null ? undefined : { background: shown }} data-none={value === null} />
        <span className="color-name">{value === MIXED ? "Mixto" : (shown ?? "Ninguno")}</span>
      </button>
      {open !== null && (
        <div
          ref={popover}
          tabIndex={-1}
          className="color-popover"
          role="dialog"
          aria-label={`Color de ${label.toLowerCase()}`}
          style={{ top: open.top, left: open.left }}
        >
          <div
            ref={wheel}
            className="color-wheel"
            style={{ width: WHEEL_RADIUS * 2, height: WHEEL_RADIUS * 2 }}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture?.(event.pointerId);
              update(fromWheel(event), draft.alpha);
            }}
            onPointerMove={(event) => {
              if (event.buttons === 1) {
                update(fromWheel(event), draft.alpha);
              }
            }}
            onPointerUp={(event) => commit(hexOf(fromWheel(event), draft.alpha))}
          >
            <div className="color-wheel-shade" style={{ opacity: 1 - draft.hsv.v }} />
            <div
              className="color-wheel-marker"
              style={{ transform: `translate(${WHEEL_RADIUS + marker.x - 6}px, ${WHEEL_RADIUS + marker.y - 6}px)` }}
            />
          </div>
          <label className="color-slider">
            <span>Brillo</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(draft.hsv.v * 100)}
              onChange={(event) => update({ ...draft.hsv, v: Number(event.currentTarget.value) / 100 }, draft.alpha)}
              onPointerUp={() => commit(draft.hex)}
              onKeyUp={() => commit(draft.hex)}
            />
          </label>
          <label className="color-slider">
            <span>Opacidad</span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(draft.alpha * 100)}
              onChange={(event) => update(draft.hsv, Number(event.currentTarget.value) / 100)}
              onPointerUp={() => commit(draft.hex)}
              onKeyUp={() => commit(draft.hex)}
            />
          </label>
          <input
            className="color-hex"
            aria-label="Hexadecimal"
            value={draft.hex}
            onChange={(event) => setDraft({ ...draft, hex: event.currentTarget.value })}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key !== "Enter") {
                return;
              }
              event.preventDefault();
              const parsed = parseColor(draft.hex);
              if (parsed !== null) {
                setDraft({ hsv: rgbToHsv(parsed), alpha: parsed.a, hex: formatColor(parsed) });
                commit(formatColor(parsed));
              }
            }}
          />
          {recent.length > 0 && (
            <div className="color-recent" aria-label="Colores recientes">
              {recent.map((color) => (
                <button
                  key={color}
                  type="button"
                  className="color-chip"
                  style={{ background: color }}
                  aria-label={color}
                  title={color}
                  onClick={() => {
                    const parsed = parseColor(color);
                    if (parsed !== null) {
                      setDraft({ hsv: rgbToHsv(parsed), alpha: parsed.a, hex: color });
                    }
                    commit(color);
                  }}
                />
              ))}
            </div>
          )}
          {allowNone && (
            <button
              type="button"
              className="color-none"
              onClick={() => {
                commit(null);
                setOpen(null);
              }}
            >
              Sin {label.toLowerCase()}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
