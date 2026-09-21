/**
 * El panel de páginas: una miniatura por página, en orden.
 *
 * Las miniaturas son **el SVG que devolvió Typst** (principio 2), el mismo
 * que enseña el lienzo, colocado como imagen a lo ancho de la fila. Mientras
 * no haya compilación se ve el hueco con su tamaño.
 *
 * - Pulsar una miniatura lleva a esa página.
 * - Arrastrar una fila la cambia de sitio; se suelta y se manda un único
 *   `Op::ReorderPage`. Esc cancela.
 * - Los botones añaden una página detrás de la que se ve, la duplican —con
 *   ids nuevos para todo lo que lleva dentro— o la quitan. **La última no se
 *   puede quitar.**
 *
 * Todo son comandos del núcleo, así que ⌘Z deshace cualquiera de ellos.
 */
import { type PointerEvent, useState } from "react";

import { applyOp } from "../commands";
import { type ImageLoader, browserImageLoader, useDecodedSvgUrl } from "../canvas/PageSvg";
import { newElementId } from "../canvas/createGeometry";
import { useRenderedPages } from "../store/compilation";
import { useCurrentPage, useDocumentStore, useOpenDocument } from "../store/document";
import type { Page } from "../types/model";

/** Cuánto hay que arrastrar para que cuente como mover la página, en px. */
const DRAG_THRESHOLD_PX = 4;

/** Lo que dura un arrastre de filas. */
interface RowDrag {
  /** La página que se arrastra. */
  id: string;
  /** De dónde salió, contando desde 0. */
  from: number;
  startY: number;
  moved: boolean;
  /** Dónde caería ahora. */
  to: number;
}

export interface PagesPanelProps {
  /** Solo para pruebas: cómo se convierte un SVG en imagen. */
  loader?: ImageLoader;
}

export function PagesPanel({ loader = browserImageLoader }: PagesPanelProps = {}) {
  const document = useOpenDocument();
  const current = useCurrentPage();
  const svgs = useRenderedPages();
  const [drag, setDrag] = useState<RowDrag | null>(null);

  if (document === null) {
    return null;
  }
  const pages = document.pages;

  const run = (op: Parameters<typeof applyOp>[0]) => {
    void applyOp(op)
      .then((applied) => useDocumentStore.getState().applyEdit(applied))
      .catch(() => {
        // Si el núcleo no lo acepta, no cambia nada.
      });
  };

  const add = () => {
    const size = pages[current]?.size ?? { width: 210, height: 297, unit: "mm" as const };
    const page: Page = { id: newElementId(document, "pagina"), size, elements: [] };
    run({ op: "insert_page", index: current + 1, page });
    useDocumentStore.getState().setCurrentPage(current + 1);
  };

  const duplicate = () => {
    const id = pages[current]?.id;
    if (id === undefined) {
      return;
    }
    run({ op: "duplicate_page", id, to: newElementId(document, "pagina") });
    useDocumentStore.getState().setCurrentPage(current + 1);
  };

  const remove = () => {
    const id = pages[current]?.id;
    if (id === undefined || pages.length < 2) {
      return;
    }
    run({ op: "remove_page", id });
  };

  const onPointerDown = (id: string, from: number, event: PointerEvent<HTMLLIElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
    useDocumentStore.getState().setCurrentPage(from);
    setDrag({ id, from, startY: event.clientY, moved: false, to: from });
  };

  const onPointerMove = (event: PointerEvent<HTMLOListElement>) => {
    if (drag === null) {
      return;
    }
    const rows = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-page]")];
    const to = rows.findIndex((row) => {
      const area = row.getBoundingClientRect();
      return event.clientY < area.top + area.height / 2;
    });
    setDrag({
      ...drag,
      moved: drag.moved || Math.abs(event.clientY - drag.startY) >= DRAG_THRESHOLD_PX,
      to: to === -1 ? rows.length - 1 : to,
    });
  };

  const onPointerUp = () => {
    if (drag === null) {
      return;
    }
    setDrag(null);
    if (drag.moved && drag.to !== drag.from) {
      run({ op: "reorder_page", id: drag.id, index: drag.to });
      useDocumentStore.getState().setCurrentPage(drag.to);
    }
  };

  return (
    <div className="pages-panel">
      <div className="pages-actions">
        <button type="button" onClick={add}>
          Añadir
        </button>
        <button type="button" onClick={duplicate}>
          Duplicar
        </button>
        <button type="button" onClick={remove} disabled={pages.length < 2}>
          Eliminar
        </button>
      </div>
      <ol
        className="pages"
        aria-label="Páginas"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={(event) => {
          if (event.key === "Escape" && drag !== null) {
            event.preventDefault();
            setDrag(null);
          }
        }}
      >
        {pages.map((page, index) => (
          <li
            key={page.id}
            data-page={page.id}
            className={[
              "page-row",
              index === current ? "is-current" : "",
              drag?.moved === true && drag.to === index ? "is-target" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            aria-current={index === current}
            onPointerDown={(event) => onPointerDown(page.id, index, event)}
          >
            <Thumbnail svg={svgs[index] ?? null} page={page} loader={loader} />
            <span className="page-number">{index + 1}</span>
            <span className="page-id">{page.id}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** El SVG de la página como imagen, con su proporción. */
function Thumbnail({
  svg,
  page,
  loader,
}: {
  svg: string | null;
  page: Page;
  loader: ImageLoader;
}) {
  const url = useDecodedSvgUrl(svg, loader);
  const ratio = page.size.height === 0 ? 1 : page.size.width / page.size.height;

  return (
    <span className="page-thumbnail" style={{ aspectRatio: `${ratio}` }}>
      {url !== null && <img src={url} alt="" />}
    </span>
  );
}
