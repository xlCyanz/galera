/**
 * El lienzo: el área de trabajo con la página visible centrada.
 *
 * Lee del store el documento, la página actual, el zoom y las páginas
 * compiladas, y coloca la página con su tamaño exacto (ver `geometry.ts`).
 * Si la página es más pequeña que el área, queda centrada; si es más grande,
 * el área se desplaza. La navegación con rueda, gestos y atajos es F1-09.
 *
 * El lienzo expone la escala como la variable CSS `--px-per-mm`, para que
 * lo que se dibuje encima use la misma.
 */
import type { CSSProperties } from "react";

import { useRenderedPages } from "../store/compilation";
import { useCurrentPage, useOpenDocument, useZoom } from "../store/document";
import { type ImageLoader, PageSvg } from "./PageSvg";
import { PX_PER_MM, pageSizeInPx } from "./geometry";

export interface CanvasProps {
  /** Solo para pruebas. */
  loader?: ImageLoader;
}

export function Canvas({ loader }: CanvasProps) {
  const document = useOpenDocument();
  const currentPage = useCurrentPage();
  const zoom = useZoom();
  const pages = useRenderedPages();

  const page = document?.pages[currentPage];
  const style = { "--px-per-mm": PX_PER_MM * zoom } as CSSProperties;

  return (
    <div className="canvas" style={style} data-testid="canvas">
      {document !== null && page !== undefined && (
        <PageSvg
          {...pageSizeInPx(page.size, zoom)}
          svg={pages[currentPage] ?? null}
          label={`Página ${currentPage + 1} de ${document.pages.length}`}
          {...(loader === undefined ? {} : { loader })}
        />
      )}
    </div>
  );
}
