/**
 * El inspector de texto: el estilo del cuadro entero —fuente, tamaño,
 * color, alineación, interlineado y espacio entre párrafos—. El formato por
 * tramos dentro del texto llega con la Fase 4.
 *
 * Cada cambio es un `SetProperty` del estilo (`textFields.ts`): entra en el
 * historial y lo dibuja Typst al recompilar; la interfaz no pinta el texto.
 */
import { applyOp } from "../commands";
import { useDocumentStore } from "../store/document";
import type { Align, Element } from "../types/model";
import { ColorPicker } from "./ColorPicker";
import { FontSelect } from "./FontSelect";
import { MeasureField } from "./MeasureField";
import { DEFAULT_PARAGRAPH_SPACING, type TextStyleChange, textStyleOp } from "./textFields";

const ALIGNS: Array<{ value: Align; label: string; icon: string }> = [
  { value: "left", label: "Izquierda", icon: "M3 5h14M3 9h9M3 13h14M3 17h9" },
  { value: "center", label: "Centro", icon: "M3 5h14M5.5 9h9M3 13h14M5.5 17h9" },
  { value: "right", label: "Derecha", icon: "M3 5h14M8 9h9M3 13h14M8 17h9" },
  { value: "justify", label: "Justificado", icon: "M3 5h14M3 9h14M3 13h14M3 17h14" },
];

type Text = Extract<Element, { type: "text" }>;

/** Cambia el estilo del texto, leyéndolo del store: puede haber cambiado desde el render. */
function change(id: string, patch: TextStyleChange) {
  const element = useDocumentStore
    .getState()
    .document?.pages.flatMap((page) => page.elements)
    .find((candidate) => candidate.id === id);
  const op = element === undefined ? null : textStyleOp(element, patch);
  if (op === null) {
    return;
  }
  void applyOp(op)
    .then((applied) => useDocumentStore.getState().applyEdit(applied))
    .catch(() => undefined);
}

export function TextInspector({ element }: { element: Text }) {
  const { style } = element;
  return (
    <div className="shape-inspector">
      <FontSelect id={element.id} style={style} />
      <div className="inspector-grid">
        <MeasureField
          label="Tam"
          title="Tamaño"
          value={style.size}
          unit="pt"
          onCommit={(size) => change(element.id, { size })}
        />
      </div>
      <div className="inspector-row">
        <span className="inspector-label">Color</span>
        <ColorPicker
          label="Color"
          value={style.color}
          onCommit={(color) => {
            if (color !== null) {
              change(element.id, { color });
            }
          }}
        />
      </div>
      <div className="inspector-row">
        <span className="inspector-label">Alinear</span>
        <div className="align-buttons" role="group" aria-label="Alineación">
          {ALIGNS.map(({ value, label, icon }) => (
            <button
              key={value}
              type="button"
              className="tool-button align-button"
              aria-label={label}
              aria-pressed={style.align === value}
              title={label}
              onClick={() => change(element.id, { align: value })}
            >
              <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
                <path d={icon} />
              </svg>
            </button>
          ))}
        </div>
      </div>
      <div className="inspector-grid">
        <MeasureField
          label="Int"
          title="Interlineado"
          value={style.leading}
          unit="em"
          step={0.05}
          onCommit={(leading) => change(element.id, { leading })}
        />
        <MeasureField
          label="Pár"
          title="Espacio entre párrafos"
          value={style.spacing ?? DEFAULT_PARAGRAPH_SPACING}
          unit="em"
          step={0.1}
          {...(style.spacing === undefined ? { note: "auto" } : {})}
          onCommit={(spacing) => change(element.id, { spacing })}
        />
      </div>
    </div>
  );
}
