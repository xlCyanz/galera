/**
 * El panel derecho: posición, tamaño y giro del elemento seleccionado,
 * editables a mano (`MeasureField.tsx`). Cada cambio es un comando de `ops`,
 * como al arrastrar en el lienzo: entra en el historial y recompila. Las
 * cuentas están en `inspectorFields.ts`.
 *
 * Sin selección, enseña la página que se ve: su id, su tamaño y cuántos
 * elementos tiene.
 */
import { applyOp } from "../commands";
import { toMillimeters } from "../canvas/geometry";
import { useCurrentPage, useDocumentStore, useOpenDocument, useSelectedElement } from "../store/document";
import { useElementBox } from "../store/layout";
import type { Element, Page } from "../types/model";
import { MeasureField } from "./MeasureField";
import { formatNumber } from "./fieldValue";
import { type FieldName, fieldOp, inspectorFields } from "./inspectorFields";

/** Cómo se llama cada tipo de elemento en la interfaz. */
const KIND: Record<Element["type"], string> = {
  text: "Texto",
  rect: "Rectángulo",
  ellipse: "Elipse",
  line: "Línea",
  image: "Imagen",
  code: "Código",
};

const FIELDS: Array<{ name: FieldName; label: string; title: string; unit: string }> = [
  { name: "x", label: "X", title: "Posición horizontal", unit: "mm" },
  { name: "y", label: "Y", title: "Posición vertical", unit: "mm" },
  { name: "w", label: "An", title: "Ancho", unit: "mm" },
  { name: "h", label: "Al", title: "Alto", unit: "mm" },
  { name: "rotation", label: "Giro", title: "Rotación", unit: "°" },
];

export function Inspector() {
  const document = useOpenDocument();
  const currentPage = useCurrentPage();
  const selected = useSelectedElement();
  const measured = useElementBox(selected);

  if (document === null) {
    return null;
  }
  const element =
    selected === null
      ? undefined
      : document.pages.flatMap((page) => page.elements).find((candidate) => candidate.id === selected);
  const page = document.pages[currentPage];

  return (
    <aside className="inspector" aria-label="Inspector">
      {element !== undefined ? (
        <ElementInspector element={element} measured={measured} />
      ) : (
        page !== undefined && <PageInspector page={page} index={currentPage} />
      )}
    </aside>
  );
}

function ElementInspector({ element, measured }: { element: Element; measured: ReturnType<typeof useElementBox> }) {
  const fields = inspectorFields(element, measured);

  const commit = (name: FieldName, value: number) => {
    // Se lee del store, no de las props: entre dos flechas seguidas el
    // documento ya puede haber cambiado.
    const current = useDocumentStore
      .getState()
      .document?.pages.flatMap((page) => page.elements)
      .find((candidate) => candidate.id === element.id);
    const op = current === undefined ? null : fieldOp(current, name, value);
    if (op === null) {
      return;
    }
    void applyOp(op)
      .then((applied) => useDocumentStore.getState().applyEdit(applied))
      .catch(() => undefined);
  };

  return (
    <section>
      <h2>
        {KIND[element.type]} <span className="inspector-id">{element.id}</span>
      </h2>
      <div className="inspector-grid">
        {FIELDS.map(({ name, label, title, unit }) => {
          const field = fields[name];
          return (
            <MeasureField
              key={name}
              label={label}
              title={title}
              value={field.value}
              unit={unit}
              readOnly={!field.editable}
              {...(field.auto ? { note: "auto" } : {})}
              onCommit={(value) => commit(name, value)}
            />
          );
        })}
      </div>
    </section>
  );
}

function PageInspector({ page, index }: { page: Page; index: number }) {
  const mm = (value: number) => formatNumber(toMillimeters(value, page.size.unit));
  return (
    <section>
      <h2>
        Página {index + 1} <span className="inspector-id">{page.id}</span>
      </h2>
      <dl className="inspector-page">
        <dt>Tamaño</dt>
        <dd>
          {mm(page.size.width)} × {mm(page.size.height)} mm
        </dd>
        <dt>Elementos</dt>
        <dd>{page.elements.length}</dd>
      </dl>
    </section>
  );
}
