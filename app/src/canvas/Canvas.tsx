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
 * El lienzo expone la escala como la variable CSS `--px-per-mm`, para que
 * lo que se dibuje encima use la misma.
 */
import { type CSSProperties, useEffect, useEffectEvent, useRef } from "react";

import { isToggleRulersShortcut, isTypingTarget } from "../shortcuts";
import { useRenderedPages } from "../store/compilation";
import {
  useCurrentPage,
  useDocumentStore,
  useOpenDocument,
  useRulersVisible,
} from "../store/document";
import { type ImageLoader, PageSvg } from "./PageSvg";
import { Rulers } from "./Rulers";
import { ZoomControls } from "./ZoomControls";
import { PX_PER_MM, pageSizeInPx } from "./geometry";
import { useCanvasNavigation } from "./useCanvasNavigation";
import { pageOrigin } from "./zoom";

export interface CanvasProps {
  /** Solo para pruebas. */
  loader?: ImageLoader;
}

export function Canvas({ loader }: CanvasProps) {
  const document = useOpenDocument();
  const currentPage = useCurrentPage();
  const pages = useRenderedPages();
  const rulersVisible = useRulersVisible();

  const viewport = useRef<HTMLDivElement>(null);
  const page = document?.pages[currentPage];
  const { zoom, scroll, viewportSize, run, panReady, panning, viewportHandlers } =
    useCanvasNavigation(viewport, page?.size ?? null);

  const size = page === undefined ? null : pageSizeInPx(page.size, zoom);
  const origin = size === null ? null : pageOrigin(viewportSize, size, scroll);

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (page !== undefined && isToggleRulersShortcut(event) && !isTypingTarget(event.target)) {
      event.preventDefault();
      useDocumentStore.getState().toggleRulers();
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
      {rulersVisible && origin !== null && (
        <Rulers
          viewport={viewport}
          origin={origin}
          pxPerMm={PX_PER_MM * zoom}
          size={viewportSize}
        />
      )}
      <div className="canvas-area">
        <div ref={viewport} className={viewportClass} {...viewportHandlers}>
          {document !== null && page !== undefined && size !== null && origin !== null && (
            <PageSvg
              {...size}
              left={origin.x}
              top={origin.y}
              svg={pages[currentPage] ?? null}
              label={`Página ${currentPage + 1} de ${document.pages.length}`}
              {...(loader === undefined ? {} : { loader })}
            />
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
