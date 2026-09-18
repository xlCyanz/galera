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
 *
 * La herramienta activa (`store/tool.ts`) decide qué hace el clic: con la
 * de selección, seleccionar y arrastrar; con la mano, desplazar; con las que
 * crean formas y textos, dibujarlos (`useCreate.ts`); con la de imagen,
 * elegir imágenes e insertarlas donde se pulsó (`useFileDrop.ts`). Soltar
 * imágenes desde el sistema funciona con cualquier herramienta. Escape
 * vuelve a la de selección.
 *
 * Un elemento bloqueado no se acierta con el clic (lo decide el núcleo); si
 * se selecciona desde el panel de capas, su contorno se ve pero no se
 * agarra, y las flechas no lo mueven.
 */
import { type CSSProperties, useEffect, useEffectEvent, useRef, useState } from "react";

import { applyOp } from "../commands";

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
import { useTool, useToolStore } from "../store/tool";
import { ControlLayer } from "./ControlLayer";
import { CreatePreview } from "./CreatePreview";
import { DragGhost } from "./DragGhost";
import { ElementHighlight } from "./ElementHighlight";
import { type ImageLoader, PageSvg } from "./PageSvg";
import { Rulers } from "./Rulers";
import { ZoomControls } from "./ZoomControls";
import { PX_PER_MM, pageSizeInPx, toMillimeters } from "./geometry";
import { canvasTransform, rectToCanvas, toCanvas } from "./transform";
import { type NudgeBurst, arrowNudge, nudgeBurst, rotatedCorners } from "./dragGeometry";
import { findElement } from "./elements";
import { useCanvasNavigation } from "./useCanvasNavigation";
import { useDrag } from "./useDrag";
import { useCreate } from "./useCreate";
import { useFileDrop } from "./useFileDrop";
import { useResize } from "./useResize";
import { useRotate } from "./useRotate";
import { useSelection } from "./useSelection";
import { centerOn } from "./zoom";

export interface CanvasProps {
  /** Solo para pruebas. */
  loader?: ImageLoader;
  /** Solo para pruebas: cómo escuchar lo que se suelta desde el sistema. */
  subscribeToDrops?: Parameters<typeof useFileDrop>[3];
}

export function Canvas({ loader, subscribeToDrops }: CanvasProps) {
  const document = useOpenDocument();
  const currentPage = useCurrentPage();
  const pages = useRenderedPages();
  const rulersVisible = useRulersVisible();
  const highlighted = useHighlightedElement();
  const selected = useSelectedElement();
  const selectedBox = useElementBox(selected);
  const focusRequests = useFocusRequests();
  const tool = useTool();
  const selecting = tool === "select";
  // Un elemento bloqueado se selecciona desde el panel de capas, pero en el
  // lienzo no se agarra ni se empuja con las flechas.
  const selectedLocked =
    selected !== null &&
    document?.pages.some((page) => page.elements.some((element) => element.id === selected && element.locked === true)) ===
      true;

  const viewport = useRef<HTMLDivElement>(null);
  const page = document?.pages[currentPage];
  const { zoom, scroll, viewportSize, run, panReady, panning, viewportHandlers } =
    useCanvasNavigation(viewport, page?.size ?? null, tool === "hand");

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
  const drag = useDrag(transform?.pxPerMm ?? null);
  // Pulsar un elemento y arrastrar sin soltar lo selecciona y lo mueve.
  const onSelect = useSelection(transform, currentPage, drag.start);
  // La imagen que enseña la hoja, para la copia que se arrastra.
  const [shownUrl, setShownUrl] = useState<string | null>(null);
  const resize = useResize(transform?.pxPerMm ?? null);
  const resized =
    resize.state.phase !== "idle" && selectedBox !== null && resize.state.id === selectedBox.id
      ? resize.state
      : null;
  const rotate = useRotate();
  const create = useCreate(transform, currentPage);
  const fileDrop = useFileDrop(viewport, transform, currentPage, subscribeToDrops);
  const rotated =
    rotate.state.phase !== "idle" && selectedBox !== null && rotate.state.id === selectedBox.id
      ? rotate.state
      : null;
  const dragged = drag.state.phase === "idle" ? null : drag.state;
  const dragOffset =
    dragged !== null && selectedBox !== null && dragged.id === selectedBox.id
      ? dragged.delta
      : { dx: 0, dy: 0 };
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

  // Los empujones seguidos con las flechas son un único paso del historial.
  const burst = useRef<NudgeBurst | null>(null);

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (page === undefined || isTypingTarget(event.target)) {
      return;
    }
    const nudge = arrowNudge(event);
    if (isToggleRulersShortcut(event)) {
      event.preventDefault();
      useDocumentStore.getState().toggleRulers();
    } else if (event.key === "Escape" && useToolStore.getState().tool !== "select") {
      useToolStore.getState().setTool("select");
    } else if (
      event.key === "Escape" &&
      drag.state.phase !== "dragging" &&
      resize.state.phase !== "resizing" &&
      rotate.state.phase !== "rotating"
    ) {
      // Durante un arrastre, Escape lo cancela (ver `useDrag.ts`).
      useDocumentStore.getState().clearHighlight();
      useDocumentStore.getState().select(null);
    } else if (nudge !== null && selected !== null && !selectedLocked && drag.state.phase === "idle") {
      event.preventDefault();
      burst.current = nudgeBurst(burst.current, selected, event.timeStamp);
      void applyOp({ op: "move", id: selected, ...nudge }, burst.current.group)
        .then((applied) => useDocumentStore.getState().applyEdit(applied))
        .catch(() => undefined);
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
    fileDrop.over ? "is-drop-target" : "",
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
          data-tool={tool}
          {...viewportHandlers}
          onPointerDown={(event) => {
            // Primero desplazar (Espacio, botón central o la mano); si no,
            // seleccionar, si es la herramienta de selección.
            viewportHandlers.onPointerDown(event);
            if (selecting) {
              onSelect(event);
            } else if (tool === "rect" || tool === "ellipse" || tool === "line" || tool === "text") {
              create.onPointerDown(tool, event);
            } else if (tool === "image") {
              fileDrop.insertFromDialog(event);
            }
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
              onShown={setShownUrl}
              {...(loader === undefined ? {} : { loader })}
            />
          )}
          {(dragged !== null || rotated !== null) &&
            selectedBox !== null &&
            selectedBox.page === currentPage &&
            transform !== null &&
            sheet !== null &&
            shownUrl !== null && (
              <DragGhost
                url={shownUrl}
                sheet={sheet}
                corners={rotatedCorners(selectedBox, selectedBox.rotation).map(({ x, y }) =>
                  toCanvas(transform, x, y),
                )}
                offset={{
                  x: dragOffset.dx * transform.pxPerMm,
                  y: dragOffset.dy * transform.pxPerMm,
                }}
                {...(rotated === null
                  ? {}
                  : {
                      turn: {
                        degrees: rotated.rotation - selectedBox.rotation,
                        pivot: toCanvas(
                          transform,
                          selectedBox.x + selectedBox.w / 2,
                          selectedBox.y + selectedBox.h / 2,
                        ),
                      },
                    })}
              />
            )}
          {selectedBox !== null && selectedBox.page === currentPage && transform !== null && (
            <ControlLayer
              box={{
                ...selectedBox,
                ...(resized === null ? {} : resized.box),
                ...(rotated === null ? {} : { rotation: rotated.rotation }),
              }}
              transform={transform}
              offset={dragOffset}
              showSize={resized?.phase === "resizing"}
              showAngle={rotated?.phase === "rotating"}
              interactive={selecting && !selectedLocked}
              onRotateStart={(event) => {
                // El centro del elemento en la pantalla: alrededor de él gira el puntero.
                const area = viewport.current?.getBoundingClientRect();
                const center = toCanvas(
                  transform,
                  selectedBox.x + selectedBox.w / 2,
                  selectedBox.y + selectedBox.h / 2,
                );
                rotate.start(
                  selectedBox.id,
                  selectedBox.rotation,
                  { x: center.x + (area?.left ?? 0), y: center.y + (area?.top ?? 0) },
                  event.clientX,
                  event.clientY,
                );
              }}
              onResizeStart={(handle, event) => {
                const declared = document?.pages[currentPage]?.elements.find(
                  (element) => element.id === selectedBox.id,
                );
                const autoHeight = declared !== undefined && "h" in declared && declared.h === null;
                resize.start(selectedBox.id, handle, selectedBox, autoHeight, event.clientX, event.clientY);
              }}
              onBodyPointerDown={(event) => {
                // Alt o ⌘ atraviesan hacia el elemento de abajo: eso lo
                // decide el lienzo, no se arrastra.
                if (event.button !== 0 || event.altKey || event.metaKey) {
                  return;
                }
                event.stopPropagation();
                event.preventDefault();
                drag.start(selectedBox.id, event.clientX, event.clientY);
              }}
            />
          )}
          {create.state.phase !== "idle" && transform !== null && (
            <CreatePreview shape={create.state.shape} transform={transform} />
          )}
          {create.state.phase === "needsFont" && (
            <div className="canvas-notice" role="alert" onPointerDown={(event) => event.stopPropagation()}>
              <p>
                {create.state.error ??
                  "El proyecto no tiene ninguna fuente: añade una para poder crear textos."}
              </p>
              <button type="button" onClick={() => void create.addFont()}>
                Añadir fuente…
              </button>
              <button type="button" onClick={create.dismiss}>
                Cancelar
              </button>
            </div>
          )}
          {fileDrop.messages.length > 0 && (
            <div className="canvas-notice" role="alert" onPointerDown={(event) => event.stopPropagation()}>
              <div>
                {fileDrop.messages.map((message) => (
                  <p key={message}>{message}</p>
                ))}
              </div>
              <button type="button" onClick={fileDrop.dismiss}>
                Cerrar
              </button>
            </div>
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
