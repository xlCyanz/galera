/**
 * El inspector de formas: relleno, borde y radio de rectángulos, elipses y
 * líneas (las cuentas, en `shapeFields.ts`).
 *
 * - Relleno: color con opacidad, o ninguno (`null`).
 * - Borde: se activa o se quita del todo (`null`); color, grosor y estilo.
 *   Una línea siempre tiene trazo.
 * - Radio de las esquinas de un rectángulo: con el campo o arrastrando su
 *   etiqueta, como las medidas.
 *
 * Recibe una lista de elementos: con varios seleccionados (F5-03) enseña lo
 * común y marca como «Mixto» lo que no coincide. Cada cambio es un grupo de
 * `SetProperty`, un solo paso del historial.
 */
import { applyOp } from "../commands";
import { useDocumentStore } from "../store/document";
import type { Dash, Element } from "../types/model";
import type { Op } from "../types/ops";
import { ColorPicker } from "./ColorPicker";
import { MeasureField } from "./MeasureField";
import { MIXED, fillOps, radiusOps, shapeFields, strokeOps } from "./shapeFields";

const DASHES: Array<{ value: Dash | "solid"; label: string }> = [
  { value: "solid", label: "Continuo" },
  { value: "dashed", label: "Rayas" },
  { value: "dotted", label: "Puntos" },
  { value: "dash-dotted", label: "Raya y punto" },
];

let changes = 0;

/** Manda los comandos como un solo paso del historial. */
async function run(ops: Op[]) {
  changes += 1;
  const group = ops.length > 1 ? `shape-${changes}` : undefined;
  for (const op of ops) {
    try {
      const applied = await applyOp(op, group);
      useDocumentStore.getState().applyEdit(applied);
    } catch {
      return;
    }
  }
}

/** Los elementos de ahora, leídos del store: pueden haber cambiado desde el render. */
function current(ids: readonly string[]): Element[] {
  const document = useDocumentStore.getState().document;
  const all = document?.pages.flatMap((page) => page.elements) ?? [];
  return ids.flatMap((id) => all.filter((element) => element.id === id));
}

export function ShapeInspector({ elements }: { elements: readonly Element[] }) {
  const fields = shapeFields(elements);
  const ids = elements.map((element) => element.id);
  const apply = (build: (targets: Element[]) => Op[]) => void run(build(current(ids)));

  return (
    <div className="shape-inspector">
      {fields.hasFill && fields.fill !== undefined && (
        <div className="inspector-row">
          <span className="inspector-label">Relleno</span>
          <ColorPicker
            label="Relleno"
            value={fields.fill}
            allowNone
            onCommit={(color) => apply((targets) => fillOps(targets, color))}
          />
        </div>
      )}

      <div className="inspector-row">
        {fields.onlyLines ? (
          <span className="inspector-label">Trazo</span>
        ) : (
          <label className="inspector-label inspector-check">
            <input
              type="checkbox"
              aria-label="Borde"
              checked={fields.stroked === true}
              ref={(input) => {
                if (input !== null) {
                  input.indeterminate = fields.stroked === MIXED;
                }
              }}
              onChange={(event) => {
                const on = event.currentTarget.checked;
                apply((targets) => strokeOps(targets, on ? {} : null));
              }}
            />
            Borde
          </label>
        )}
        {fields.stroked !== false && fields.strokeColor !== undefined && (
          <ColorPicker
            label="Borde"
            value={fields.strokeColor}
            onCommit={(color) => {
              if (color !== null) {
                apply((targets) => strokeOps(targets, { color }));
              }
            }}
          />
        )}
      </div>

      {fields.stroked !== false && fields.strokeWidth !== undefined && (
        <div className="inspector-grid">
          <MeasureField
            label="Gr"
            title="Grosor del trazo"
            value={fields.strokeWidth === MIXED ? null : fields.strokeWidth}
            mixed={fields.strokeWidth === MIXED}
            unit="mm"
            onCommit={(width) => apply((targets) => strokeOps(targets, { width }))}
          />
          <select
            className="dash-select"
            aria-label="Estilo del trazo"
            value={fields.dash === MIXED ? "mixed" : (fields.dash ?? "solid")}
            onChange={(event) => {
              const value = event.currentTarget.value;
              if (value !== "mixed") {
                const dash = value === "solid" ? null : (value as Dash);
                apply((targets) => strokeOps(targets, { dash }));
              }
            }}
          >
            {fields.dash === MIXED && (
              <option value="mixed" disabled>
                Mixto
              </option>
            )}
            {DASHES.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      )}

      {fields.hasRadius && fields.radius !== undefined && (
        <div className="inspector-grid">
          <MeasureField
            label="Radio"
            title="Radio de las esquinas"
            value={fields.radius === MIXED ? null : fields.radius}
            mixed={fields.radius === MIXED}
            unit="mm"
            onCommit={(radius) => apply((targets) => radiusOps(targets, radius))}
          />
        </div>
      )}
    </div>
  );
}
