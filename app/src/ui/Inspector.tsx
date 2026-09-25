/**
 * El panel derecho: posición, tamaño y giro del elemento seleccionado,
 * editables a mano (`MeasureField.tsx`). Cada cambio es un comando de `ops`,
 * como al arrastrar en el lienzo: entra en el historial y recompila. Las
 * cuentas están en `inspectorFields.ts`.
 *
 * En un texto, además, su estilo: fuente, tamaño, color, alineación,
 * interlineado y espacio entre párrafos (`TextInspector.tsx`);
 * en una forma, su relleno, borde y radio (`ShapeInspector.tsx`); en una
 * tabla, sus filas y sus columnas (`TableInspector.tsx`); en un
 * bloque de código, su código (`CodeEditor.tsx`). El id se cambia con
 * doble clic (`IdField.tsx`).
 *
 * Con **varios** seleccionados enseña lo que tienen en común y marca como
 * «Mixto» lo que no coincide; escribir un valor lo fija en todos, como un
 * solo paso del historial.
 *
 * Arriba, alinear y repartir lo seleccionado (`AlignBar.tsx`).
 *
 * Sin selección, enseña el título del documento (editable) y la página que
 * se ve: su id, cuántos elementos tiene y su tamaño, que se cambia eligiendo
 * un papel, girándola o escribiendo el ancho y el alto (`pageSizes.ts`).
 */
import { Suspense, lazy } from "react";

import { applyOp } from "../commands";
import {
  useCurrentPage,
  useDocumentStore,
  useOpenDocument,
  useSelectedElement,
  useSelection,
} from "../store/document";
import { useElementBox, useLayoutStore } from "../store/layout";
import type { LayoutBox } from "../types/layout";
import type { Element, Page, PageSize } from "../types/model";
import { AlignBar } from "./AlignBar";
import { IdField } from "./IdField";
import { MeasureField } from "./MeasureField";
import { ShapeInspector } from "./ShapeInspector";
import { TitleField } from "./TitleField";
import { TableInspector } from "./TableInspector";
import { TextInspector } from "./TextInspector";
import { formatNumber } from "./fieldValue";
import { type FieldName, fieldOp, groupFields, inspectorFields } from "./inspectorFields";
import { ELEMENT_KIND } from "./layerOrder";
import { PAPERS, describeSize, paperSize, withMeasure, withOrientation } from "./pageSizes";
import { isShape } from "./shapeFields";

// El editor de código trae CodeMirror, que pesa: se carga la primera vez
// que se selecciona un bloque de código.
const CodeEditor = lazy(() =>
  import("./CodeEditor").then((module) => ({ default: module.CodeEditor })),
);

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
  const selection = useSelection();
  const measured = useElementBox(selected);
  const boxes = useLayoutStore((layout) => layout.boxes);

  if (document === null) {
    return null;
  }
  const all = document.pages.flatMap((page) => page.elements);
  const element =
    selected === null ? undefined : all.find((candidate) => candidate.id === selected);
  const several = selection
    .map((id) => all.find((candidate) => candidate.id === id))
    .filter((candidate) => candidate !== undefined);
  const page = document.pages[currentPage];

  return (
    <aside className="inspector" aria-label="Inspector">
      {selection.length > 1 ? (
        <GroupInspector elements={several} measured={boxes} />
      ) : element !== undefined ? (
        <ElementInspector element={element} measured={measured} />
      ) : (
        page !== undefined && (
          <PageInspector page={page} index={currentPage} title={document.meta.title} />
        )
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
        {ELEMENT_KIND[element.type]} <IdField id={element.id} />
      </h2>
      <AlignBar />
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
      {element.type === "text" && <TextInspector element={element} />}
      {element.type === "table" && <TableInspector element={element} />}
      {element.type === "code" && (
        <Suspense fallback={<p className="code-hint">Cargando el editor…</p>}>
          <CodeEditor id={element.id} source={element.source} />
        </Suspense>
      )}
      {(element.type === "rect" || element.type === "ellipse" || element.type === "line") && (
        <ShapeInspector elements={[element]} />
      )}
    </section>
  );
}

/** Varios elementos a la vez: lo común, y lo que no, como «Mixto». */
function GroupInspector({
  elements,
  measured,
}: {
  elements: readonly Element[];
  measured: Readonly<Record<string, LayoutBox>>;
}) {
  const fields = groupFields(elements, measured);
  const ids = elements.map((element) => element.id);
  const shapes = elements.filter(isShape);

  /** Fija el campo en todos: un solo comando y un solo paso del historial. */
  const commit = (name: FieldName, value: number) => {
    const all = useDocumentStore.getState().document?.pages.flatMap((page) => page.elements) ?? [];
    const ops = ids
      .map((id) => all.find((candidate) => candidate.id === id))
      .filter((element) => element !== undefined)
      .map((element) => fieldOp(element, name, value))
      .filter((op) => op !== null);
    if (ops.length === 0) {
      return;
    }
    void applyOp(ops.length === 1 && ops[0] !== undefined ? ops[0] : { op: "batch", ops })
      .then((applied) => useDocumentStore.getState().applyEdit(applied))
      .catch(() => undefined);
  };

  return (
    <section>
      <h2>{elements.length} elementos</h2>
      <AlignBar />
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
              mixed={field.mixed}
              readOnly={!field.editable}
              onCommit={(value) => commit(name, value)}
            />
          );
        })}
      </div>
      {shapes.length === elements.length && shapes.length > 0 && (
        <ShapeInspector elements={shapes} />
      )}
    </section>
  );
}

function PageInspector({ page, index, title }: { page: Page; index: number; title: string }) {
  const size = describeSize(page.size);
  const resize = (next: PageSize | null) => {
    if (next === null) {
      return;
    }
    void applyOp({ op: "resize_page", id: page.id, size: next })
      .then((applied) => useDocumentStore.getState().applyEdit(applied))
      .catch(() => undefined);
  };
  const positive = (value: number) => Number.isFinite(value) && value > 0;
  return (
    <section>
      <h2>
        Página {index + 1} <span className="inspector-id">{page.id}</span>
      </h2>
      <TitleField title={title} />
      <div className="page-size">
        <select
          className="page-paper"
          aria-label="Tamaño de la página"
          value={size.paper?.id ?? "custom"}
          onChange={(event) => {
            const paper = PAPERS.find((candidate) => candidate.id === event.currentTarget.value);
            if (paper !== undefined) {
              resize(paperSize(paper, size.orientation));
            }
          }}
        >
          {PAPERS.map((paper) => (
            <option key={paper.id} value={paper.id}>
              {paper.name} ({formatNumber(paper.width)} × {formatNumber(paper.height)} mm)
            </option>
          ))}
          {/* Solo para enseñarlo: a un tamaño a medida se llega escribiendo. */}
          <option value="custom" disabled>
            Personalizado
          </option>
        </select>
        <div className="page-orientation" role="group" aria-label="Orientación">
          {(["portrait", "landscape"] as const).map((orientation) => (
            <button
              key={orientation}
              type="button"
              aria-pressed={size.orientation === orientation}
              onClick={() => resize(withOrientation(page.size, orientation))}
            >
              {orientation === "portrait" ? "Vertical" : "Horizontal"}
            </button>
          ))}
        </div>
        <MeasureField
          label="An"
          title="Ancho de la página"
          value={size.width}
          unit="mm"
          onCommit={(width) => positive(width) && resize(withMeasure(page.size, "width", width))}
        />
        <MeasureField
          label="Al"
          title="Alto de la página"
          value={size.height}
          unit="mm"
          onCommit={(height) => positive(height) && resize(withMeasure(page.size, "height", height))}
        />
      </div>
      <dl className="inspector-page">
        <dt>Elementos</dt>
        <dd>{page.elements.length}</dd>
      </dl>
    </section>
  );
}
