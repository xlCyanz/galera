/**
 * El lienzo: el área de trabajo con la página visible.
 *
 * Lee del store el documento, la página actual y las páginas compiladas, y
 * coloca la página con su tamaño exacto (ver `geometry.ts`): centrada en el
 * área y movida lo que diga el desplazamiento (ver `zoom.ts`). El zoom y el
 * desplazamiento se manejan en `useCanvasNavigation.ts`.
 *
 * Encima y a la izquierda van las reglas (`Rulers.tsx`), que se enseñan u
 * ocultan con ⇧R.
 *
 * Cuando se pide ir a un elemento (desde un error, por ejemplo), el lienzo
 * lo centra y lo resalta (`ElementHighlight.tsx`). Escape quita el resaltado.
 *
 * El lienzo expone la escala como la variable CSS `--px-per-mm`, para que
 * lo que se dibuje encima use la misma.
 */
import { type CSSProperties, useEffect, useEffectEvent, useRef } from "react";

import { isToggleRulersShortcut, isTypingTarget } from "../shortcuts";
import { useRenderedPages } from "../store/compilation";
import {
  useCurrentPage,
  useDocumentStore,
  useFocusRequests,
  useHighlightedElement,
  useOpenDocument,
  useRulersVisible,
  useSelectedElement,
} from "../store/document";
import { useElementBox } from "../store/layout";
import { ElementHighlight } from "./ElementHighlight";
import { type ImageLoader, PageSvg } from "./PageSvg";
import { Rulers } from "./Rulers";
import { ZoomControls } from "./ZoomControls";
import { PX_PER_MM, pageSizeInPx, toMillimeters } from "./geometry";
import { canvasTransform, rectToCanvas } from "./transform";
import { findElement } from "./elements";
import { useCanvasNavigation } from "./useCanvasNavigation";
import { useSelection } from "./useSelection";
import { centerOn } from "./zoom";

export interface CanvasProps {
  /** Solo para pruebas. */
  loader?: ImageLoader;
}

export function Canvas({ loader }: CanvasProps) {
  const document = useOpenDocument();
  const currentPage = useCurrentPage();
  const pages = useRenderedPages();
  const rulersVisible = useRulersVisible();
  const highlighted = useHighlightedElement();
  const selected = useSelectedElement();
  const selectedBox = useElementBox(selected);
  const focusRequests = useFocusRequests();

  const viewport = useRef<HTMLDivElement>(null);
  const page = document?.pages[currentPage];
  const { zoom, scroll, viewportSize, run, panReady, panning, viewportHandlers } =
    useCanvasNavigation(viewport, page?.size ?? null);

  // Toda conversión de mm a píxeles del área sale de aquí (ver `transform.ts`).
  const transform =
    page === undefined ? null : canvasTransform(viewportSize, page.size, zoom, scroll);
  const sheet =
    page === undefined || transform === null
      ? null
      : rectToCanvas(transform, {
          x: 0,
          y: 0,
          w: toMillimeters(page.size.width, page.size.unit),
          h: toMillimeters(page.size.height, page.size.unit),
        });

  // El elemento resaltado: la caja que midió Typst si ya la hay, y si no, la
  // que declara el documento.
  const found = document === null || highlighted === null ? null : findElement(document, highlighted);
  const measured = useElementBox(highlighted);
  const onSelect = useSelection(transform, currentPage);
  const highlight =
    measured !== null
      ? { pageIndex: measured.page, box: { ...measured } }
      : found;

  // Centrar el elemento resaltado cada vez que se pide, con el zoom actual.
  const centerHighlighted = useEffectEvent(() => {
    if (highlight === null || page === undefined) {
      return;
    }
    const { box } = highlight;
    const center = {
      x: (box.x + box.w / 2) * PX_PER_MM,
      y: (box.y + (box.h ?? 0) / 2) * PX_PER_MM,
    };
    const view = centerOn(zoom, center, viewportSize, pageSizeInPx(page.size, 1));
    useDocumentStore.getState().setView(view.zoom, view.scroll);
  });
  useEffect(() => {
    if (focusRequests > 0) {
      centerHighlighted();
    }
  }, [focusRequests]);

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (page === undefined || isTypingTarget(event.target)) {
      return;
    }
    if (isToggleRulersShortcut(event)) {
      event.preventDefault();
      useDocumentStore.getState().toggleRulers();
    } else if (event.key === "Escape") {
      useDocumentStore.getState().clearHighlight();
      useDocumentStore.getState().select(null);
    }
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  const style = { "--px-per-mm": PX_PER_MM * zoom } as CSSProperties;
  const viewportClass = [
    "canvas-viewport",
    panReady ? "is-pan-ready" : "",
    panning ? "is-panning" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="canvas" style={style}>
      {rulersVisible && transform !== null && (
        <Rulers viewport={viewport} transform={transform} size={viewportSize} />
      )}
      <div className="canvas-area">
        <div
          ref={viewport}
          className={viewportClass}
          {...viewportHandlers}
          onPointerDown={(event) => {
            // Primero desplazar (Espacio o botón central); si no, seleccionar.
            viewportHandlers.onPointerDown(event);
            onSelect(event);
          }}
        >
          {document !== null && sheet !== null && (
            <PageSvg
              width={sheet.width}
              height={sheet.height}
              left={sheet.left}
              top={sheet.top}
              svg={pages[currentPage] ?? null}
              label={`Página ${currentPage + 1} de ${document.pages.length}`}
              {...(loader === undefined ? {} : { loader })}
            />
          )}
          {selectedBox !== null && selectedBox.page === currentPage && transform !== null && (
            <ElementHighlight box={selectedBox} transform={transform} variant="selection" />
          )}
          {highlight !== null && highlight.pageIndex === currentPage && transform !== null && (
            <ElementHighlight box={highlight.box} transform={transform} />
          )}
        </div>
        {page !== undefined && (
          <ZoomControls
            zoom={zoom}
            onCommand={run}
            rulersVisible={rulersVisible}
            onToggleRulers={() => useDocumentStore.getState().toggleRulers()}
          />
        )}
      </div>
    </div>
  );
}
