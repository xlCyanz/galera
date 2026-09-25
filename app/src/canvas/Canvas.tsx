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
 * Doble clic en un bloque de texto entra a escribirlo: el teclado va a un
 * campo invisible (`text/HiddenInput.tsx`) y cada cambio es un comando.
 * Escape o pulsar en el lienzo salen.
 *
 * Doble clic en un **grupo** entra en él y coge al hijo que haya bajo el
 * puntero; a partir de ahí el clic trabaja con sus hijos, y Escape sale.
 * ⌘G agrupa lo seleccionado y ⇧⌘G lo desagrupa (`grouping.ts`).
 *
 * Al mover o redimensionar salen las guías de alineación (`Guides.tsx`),
 * con las distancias entre elementos. Lo que se engancha y dónde van las
 * guías lo decide el núcleo; ⌘ desactiva el ajuste mientras dure el gesto.
 *
 * Un elemento bloqueado no se acierta con el clic (lo decide el núcleo); si
 * se selecciona desde el panel de capas, su contorno se ve pero no se
 * agarra, y las flechas no lo mueven.
 */
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";

import { applyOp, elementAt } from "../commands";

import { useShortcut } from "../hooks/useShortcuts";
import { useRenderedPages } from "../store/compilation";
import {
  useCurrentPage,
  useDocumentStore,
  useFocusRequests,
  useHighlightedElement,
  useEnteredGroup,
  useOpenDocument,
  useRulersVisible,
  useSelectedElement,
  useSelection as useSelectedElements,
} from "../store/document";
import {
  useEditTarget,
  useEditingCell,
  useEditingElement,
  useEditingFlow,
  useEditingStore,
} from "../store/editing";
import { useElementBox, useLayoutStore, useOverflowing } from "../store/layout";
import { useLatencyStore } from "../store/latency";
import { useTool, useToolStore } from "../store/tool";
import { isShapeTool } from "../ui/tools";
import { Cursor } from "../text/Cursor";
import { FormatBar } from "../text/FormatBar";
import { ChipPicker } from "../text/ChipPicker";
import { HiddenInput } from "../text/HiddenInput";
import { SelectionLayer } from "../text/SelectionLayer";
import type { LayoutBox } from "../types/layout";
import { linesOf, runsOf } from "../text/target";
import { FlowChain } from "./FlowChain";
import { boxOf } from "../text/table";
import { TableCells } from "./TableCells";
import { TableMenu } from "./TableMenu";
import { useTableMenu } from "./useTableMenu";
import { ColumnHandles } from "./ColumnHandles";
import { applyFormat, applyLines, useTextFormat } from "../text/useTextFormat";
import { useTextEditing } from "../text/useTextEditing";
import { ControlLayer } from "./ControlLayer";
import { CreatePreview } from "./CreatePreview";
import { DragGhost } from "./DragGhost";
import { ElementHighlight } from "./ElementHighlight";
import { Guides } from "./Guides";
import { Marquee } from "./Marquee";
import { OverflowNotice } from "./OverflowNotice";
import { type ImageLoader, PageSvg } from "./PageSvg";
import { Rulers } from "./Rulers";
import { ZoomControls } from "./ZoomControls";
import { PX_PER_MM, pageSizeInPx, toMillimeters } from "./geometry";
import { canvasTransform, rectToCanvas, toCanvas, toDocument } from "./transform";
import { type NudgeBurst, arrowNudge, nudgeBurst, roundMm, rotatedCorners } from "./dragGeometry";
import { findElement } from "./elements";
import { boxesOf, groupBox } from "./group";
import { elementById, groupSelection, isGroup, ungroupSelection } from "./grouping";
import { DEFAULT_SIZE } from "./createGeometry";
import { useCanvasNavigation } from "./useCanvasNavigation";
import { useDrag } from "./useDrag";
import { useMarquee } from "./useMarquee";
import { useCreate } from "./useCreate";
import { useFileDrop } from "./useFileDrop";
import { useResize } from "./useResize";
import { useRotate } from "./useRotate";
import { HIT_TOLERANCE_PX, useSelection } from "./useSelection";
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
  // Todo lo seleccionado: con más de uno, el lienzo enseña la caja conjunta.
  const selection = useSelectedElements();
  // El grupo en el que se ha entrado con doble clic, si hay alguno: se
  // marca con un recuadro para saber dentro de qué se está trabajando.
  const entered = useEnteredGroup();
  const enteredBox = useElementBox(entered);
  const focusRequests = useFocusRequests();
  const tool = useTool();
  const selecting = tool === "select";
  // Escribir en un texto: doble clic para entrar, Escape o pulsar fuera
  // para salir (`text/HiddenInput.tsx`).
  // Lo que no cabe en su caja: se avisa encima del elemento.
  const overflowing = useOverflowing(currentPage);
  const editing = useEditingElement();
  const editingBox = useElementBox(editing);
  // Escribir en un flujo: el texto es uno solo aunque pase por zonas de
  // varias páginas, así que sus capas se anclan a la página entera y cada
  // una se queda con los glifos que cayeron aquí.
  const editingFlow = useEditingFlow();
  // Escribir en una celda: sus capas se anclan a la caja de la tabla, que
  // es lo que gira el lienzo, y el cursor sale de los glifos de la celda.
  const editingCell = useEditingCell();
  const editingTableBox = useElementBox(editingCell?.table ?? null);
  const markedCells = useEditingStore((state) => state.marked);
  const target = useEditTarget();
  // Los tramos del texto que se escribe, para enseñar su formato.
  const editingRuns = target === null ? [] : (runsOf(document, target) ?? []);
  const editingLines = target === null ? [] : linesOf(document, target);
  // La tabla seleccionada, si lo que hay seleccionado es una tabla: es la
  // que enseña los bordes de sus columnas para arrastrarlos.
  const selectedTable =
    selected !== null &&
    document?.pages.some((page) =>
      page.elements.some((element) => element.id === selected && element.type === "table"),
    ) === true
      ? selected
      : null;
  // Un elemento bloqueado se selecciona desde el panel de capas, pero en el
  // lienzo no se agarra ni se empuja con las flechas.
  const selectedLocked =
    selected !== null &&
    document?.pages.some((page) => page.elements.some((element) => element.id === selected && element.locked === true)) ===
      true;

  const viewport = useRef<HTMLDivElement>(null);
  const page = document?.pages[currentPage];
  // La página entera como caja, para anclar lo que no es de un elemento
  // sino de la página: las capas de un flujo, que la cruza.
  const pageBox: LayoutBox | null =
    page === undefined
      ? null
      : {
          id: page.id,
          page: currentPage,
          x: 0,
          y: 0,
          w: toMillimeters(page.size.width, page.size.unit),
          h: toMillimeters(page.size.height, page.size.unit),
          rotation: 0,
          bounds: {
            x: 0,
            y: 0,
            w: toMillimeters(page.size.width, page.size.unit),
            h: toMillimeters(page.size.height, page.size.unit),
          },
          line: null,
          overflow: 0,
        };
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
  const drag = useDrag(transform?.pxPerMm ?? null, currentPage);
  const text = useTextEditing(transform, currentPage);
  // El botón derecho sobre una celda abre el menú de su tabla.
  const tableMenu = useTableMenu(transform, currentPage);
  // ⌘B, ⌘I y ⌘U sobre lo que haya seleccionado del texto.
  useTextFormat();
  // Pulsar un elemento y arrastrar sin soltar lo selecciona y lo mueve.
  const marquee = useMarquee(viewport, transform, currentPage);
  const onSelect = useSelection(transform, currentPage, drag.start, marquee.start);
  // La imagen que enseña la hoja, para la copia que se arrastra.
  const [shownUrl, setShownUrl] = useState<string | null>(null);
  // Cada imagen nueva de la página, pintada un fotograma después de
  // enseñarla: es el final de lo que tarda una tecla en verse (#208).
  const onShown = useCallback((url: string | null) => {
    setShownUrl(url);
    if (url !== null) {
      requestAnimationFrame(() => useLatencyStore.getState().painted(performance.now()));
    }
  }, []);
  const resize = useResize(transform?.pxPerMm ?? null, currentPage);
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
  const allBoxes = useLayoutStore((layout) => layout.boxes);
  const selectedBoxes = boxesOf(allBoxes, selection, currentPage);
  const many = selection.length > 1;
  const joint = many ? groupBox(selectedBoxes) : null;
  const dragged = drag.state.phase === "idle" ? null : drag.state;
  // Las guías del gesto que haya en marcha, mover o redimensionar.
  const guides = drag.guides.length > 0 ? drag.guides : resize.guides;
  const dragOffset = dragged === null ? { dx: 0, dy: 0 } : dragged.delta;
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

  // Con cualquier herramienta que no sea la de selección no se escribe.
  useEffect(() => {
    if (tool !== "select") {
      useEditingStore.getState().stop();
    }
  }, [tool]);

  // Los empujones seguidos con las flechas son un único paso del historial.
  const burst = useRef<NudgeBurst | null>(null);

  // Los atajos del lienzo llegan del registro (`shortcuts.ts`).
  /** Doble clic en un grupo: entrar en él y coger al hijo que haya debajo. */
  const enterGroup = useEffectEvent((event: { clientX: number; clientY: number; currentTarget: HTMLElement }) => {
    if (transform === null) {
      return;
    }
    const area = event.currentTarget.getBoundingClientRect();
    const point = toDocument(transform, event.clientX - area.left, event.clientY - area.top);
    const tolerance = HIT_TOLERANCE_PX / transform.pxPerMm;
    const store = useDocumentStore.getState();
    const outer = store.enteredGroup ?? store.selection[0] ?? null;
    if (!isGroup(store.document, outer)) {
      return;
    }
    void elementAt(currentPage, point.x, point.y, tolerance, outer)
      .then((id) => {
        if (id === null || id === outer) {
          return;
        }
        useDocumentStore.getState().enterGroup(outer);
        useDocumentStore.getState().select(id);
      })
      .catch(() => {
        // Sin respuesta del núcleo no se entra en nada.
      });
  });

  const onNudge = useEffectEvent((event: KeyboardEvent) => {
    const nudge = arrowNudge(event);
    if (page === undefined || nudge === null || selected === null || selectedLocked) {
      return false;
    }
    if (drag.state.phase !== "idle") {
      return false;
    }
    burst.current = nudgeBurst(burst.current, selected, event.timeStamp);
    void applyOp({ op: "move", id: selected, ...nudge }, burst.current.group)
      .then((applied) => useDocumentStore.getState().applyEdit(applied))
      .catch(() => undefined);
    return true;
  });
  for (const id of ["nudgeLeft", "nudgeRight", "nudgeUp", "nudgeDown"] as const) {
    // Los cuatro hacen lo mismo: el desplazamiento sale de la tecla.
    useShortcut(id, onNudge);
  }

  // ⌘G agrupa lo seleccionado; ⇧⌘G deshace los grupos que haya dentro.
  const onGroup = useEffectEvent(() => groupSelection(currentPage));
  const onUngroup = useEffectEvent(() => ungroupSelection());
  useShortcut("group", onGroup);
  useShortcut("ungroup", onUngroup);

  const onEscape = useEffectEvent(() => {
    // Durante un gesto, Escape lo cancela: es cosa del gesto, no un atajo.
    const gesturing =
      drag.state.phase === "dragging" ||
      marquee.state.phase === "drawing" ||
      resize.state.phase === "resizing" ||
      rotate.state.phase === "rotating" ||
      create.state.phase === "drawing" ||
      create.state.phase === "needsFont";
    if (gesturing) {
      return false;
    }
    // Dentro de un grupo, Escape sale de él antes que nada.
    if (useDocumentStore.getState().enteredGroup !== null) {
      useDocumentStore.getState().enterGroup(null);
      return true;
    }
    if (useToolStore.getState().tool !== "select") {
      useToolStore.getState().setTool("select");
      return true;
    }
    useDocumentStore.getState().clearHighlight();
    useDocumentStore.getState().select(null);
    return true;
  });
  useShortcut("deselect", onEscape);
  // ⌘A: todo lo de la página, o todo lo del grupo en el que se ha entrado.
  // Lo bloqueado y lo oculto no, igual que no se cogen con el ratón.
  useShortcut("selectAll", () => {
    const store = useDocumentStore.getState();
    const onPage = store.document?.pages[currentPage]?.elements;
    if (store.document === null || onPage === undefined) {
      return false;
    }
    const group = store.enteredGroup === null ? undefined : elementById(store.document, store.enteredGroup);
    const inside = group?.type === "group" ? group.children : onPage;
    store.selectMany(
      inside.filter((element) => element.hidden !== true && element.locked !== true).map((element) => element.id),
    );
    return true;
  });

  /**
   * Intro sobre el lienzo, sin ratón (F8-02, #89):
   *
   * - Con una herramienta de crear, crea el elemento del tamaño por defecto
   *   en el centro de la página, que es lo que haría un clic sin arrastrar.
   *   Con la de imagen, abre el diálogo para elegirla.
   * - Con algo seleccionado, entra: en un texto, una zona o una tabla, a
   *   escribir, como el doble clic; en un grupo, a lo que lleva dentro.
   *
   * Solo cuando el foco está en el propio lienzo: una tecla que se escribe
   * en un texto también pasa por aquí de camino.
   */
  const onCanvasKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    // Escribiendo en una celda, ⇧F10 o la tecla de menú abren el menú de su
    // tabla, que con el ratón es el botón derecho. Llega desde el campo
    // invisible, así que va antes de mirar quién tiene el foco.
    if (editingCell !== null && transform !== null && (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))) {
      const cell = boxOf(useLayoutStore.getState().cells, editingCell.table, editingCell.row, editingCell.column);
      if (cell !== null) {
        const corner = toCanvas(transform, cell.x, cell.y + cell.h);
        tableMenu.openAt({ ...editingCell, x: corner.x, y: corner.y });
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
    if (
      event.target !== event.currentTarget ||
      event.key !== "Enter" ||
      event.altKey ||
      event.metaKey ||
      event.ctrlKey ||
      page === undefined
    ) {
      return;
    }
    const width = toMillimeters(page.size.width, page.size.unit);
    const height = toMillimeters(page.size.height, page.size.unit);
    if (isShapeTool(tool)) {
      const size = DEFAULT_SIZE[tool];
      create.createAt(tool, { x: roundMm((width - size.w) / 2), y: roundMm((height - size.h) / 2) });
    } else if (tool === "image") {
      fileDrop.insertAt({ x: roundMm(width / 2), y: roundMm(height / 2) });
    } else {
      const store = useDocumentStore.getState();
      const id = store.selection.length === 1 ? (store.selection[0] ?? null) : null;
      const element = id === null || store.document === null ? undefined : elementById(store.document, id);
      if (id === null || element === undefined) {
        return;
      }
      if (element.type === "group") {
        const top = element.children.at(-1);
        if (top === undefined) {
          return;
        }
        store.enterGroup(id);
        store.select(top.id);
      } else if (!text.enter(id)) {
        return;
      }
    }
    event.preventDefault();
  };
  useShortcut("toggleRulers", () => useDocumentStore.getState().toggleRulers());

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
          // Una parada del tabulador: sin foco no hay teclado en el lienzo.
          tabIndex={0}
          role="application"
          aria-roledescription="lienzo"
          aria-label={`Lienzo, página ${currentPage + 1}`}
          onKeyDown={onCanvasKey}
          {...viewportHandlers}
          onDoubleClick={(event) => {
            // Doble clic en un grupo: se entra en él y se coge lo que haya
            // bajo el puntero. Si no es un grupo, sigue su camino: en un
            // texto, entrar a escribirlo.
            enterGroup(event);
            text.onDoubleClick(event);
          }}
          onContextMenu={tableMenu.onContextMenu}
          onPointerDown={(event) => {
            // Con el menú de una tabla abierto, pulsar en cualquier sitio
            // lo cierra antes que nada.
            if (tableMenu.menu !== null) {
              tableMenu.close();
            }
            // Dentro del texto que se escribe, el puntero coloca el cursor
            // y selecciona; fuera, deja de escribir y sigue el camino
            // normal del lienzo.
            if (text.onPointerDown(event)) {
              return;
            }
            // Primero desplazar (Espacio, botón central o la mano); si no,
            // seleccionar, si es la herramienta de selección.
            viewportHandlers.onPointerDown(event);
            if (selecting) {
              onSelect(event);
            } else if (isShapeTool(tool)) {
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
              onShown={onShown}
              {...(loader === undefined ? {} : { loader })}
            />
          )}
          {(dragged !== null || rotated !== null) &&
            transform !== null &&
            sheet !== null &&
            shownUrl !== null &&
            selectedBoxes.map((box) => (
              <DragGhost
                key={box.id}
                url={shownUrl}
                sheet={sheet}
                corners={rotatedCorners(box, box.rotation).map(({ x, y }) =>
                  toCanvas(transform, x, y),
                )}
                offset={{
                  x: dragOffset.dx * transform.pxPerMm,
                  y: dragOffset.dy * transform.pxPerMm,
                }}
                {...(rotated === null || box.id !== rotated.id
                  ? {}
                  : {
                      turn: {
                        degrees: rotated.rotation - box.rotation,
                        pivot: toCanvas(transform, box.x + box.w / 2, box.y + box.h / 2),
                      },
                    })}
              />
            ))}
          {enteredBox !== null && enteredBox.page === currentPage && transform !== null && (
            <div className="entered-group">
              <ElementHighlight box={enteredBox} transform={transform} />
            </div>
          )}
          {transform !== null && marquee.state.phase === "drawing" && (
            <Marquee rect={marquee.state.rect} transform={transform} />
          )}
          {transform !== null && <Guides guides={guides} transform={transform} />}
          {joint !== null && transform !== null && (
            <ControlLayer
              box={{
                id: "grupo",
                page: currentPage,
                ...(resized === null ? joint : resized.box),
                rotation: 0,
                bounds: joint,
                line: null,
                overflow: 0,
              }}
              transform={transform}
              offset={dragOffset}
              showSize={resized?.phase === "resizing"}
              rotatable={false}
              interactive={selecting}
              onResizeStart={(handle, event) =>
                // La caja conjunta no tiene alto automático: lo que midan
                // los elementos por dentro sigue siendo cosa suya.
                resize.start(selection, handle, { ...joint, rotation: 0 }, false, event.clientX, event.clientY)
              }
              onBodyPointerDown={(event) => {
                if (event.button !== 0 || event.altKey || event.metaKey) {
                  return;
                }
                event.stopPropagation();
                event.preventDefault();
                drag.start(selection, event.clientX, event.clientY);
              }}
            />
          )}
          {!many && selectedBox !== null && selectedBox.page === currentPage && transform !== null && (
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
              // Mientras se escribe en él, el contorno no se agarra: el
              // puntero es del texto.
              interactive={selecting && !selectedLocked && editing !== selectedBox.id}
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
                resize.start([selectedBox.id], handle, selectedBox, autoHeight, event.clientX, event.clientY);
              }}
              onBodyPointerDown={(event) => {
                // Alt o ⌘ atraviesan hacia el elemento de abajo: eso lo
                // decide el lienzo, no se arrastra.
                if (event.button !== 0 || event.altKey || event.metaKey) {
                  return;
                }
                event.stopPropagation();
                event.preventDefault();
                drag.start([selectedBox.id], event.clientX, event.clientY);
              }}
            />
          )}
          {editingFlow !== null && transform !== null && pageBox !== null && (
            <>
              <FlowChain flow={editingFlow} page={currentPage} transform={transform} />
              <HiddenInput
                target={{ kind: "flow", name: editingFlow }}
                box={pageBox}
                transform={transform}
              />
              <SelectionLayer box={pageBox} transform={transform} page={currentPage} />
              <Cursor box={pageBox} transform={transform} page={currentPage} />
              <FormatBar
                runs={editingRuns}
                lines={editingLines}
                transform={transform}
                onFormat={applyFormat}
                onLines={applyLines}
              />
            </>
          )}
          {tableMenu.menu !== null && (
            <TableMenu at={tableMenu.menu} onClose={tableMenu.close} />
          )}
          {selectedTable !== null &&
            selectedBox !== null &&
            selectedBox.page === currentPage &&
            transform !== null && (
              <ColumnHandles table={selectedTable} box={selectedBox} transform={transform} />
            )}
          {editingCell !== null &&
            editingTableBox !== null &&
            editingTableBox.page === currentPage &&
            transform !== null && (
              <>
                <TableCells
                  table={editingCell.table}
                  box={editingTableBox}
                  page={currentPage}
                  transform={transform}
                  marked={[
                    { row: editingCell.row, column: editingCell.column },
                    ...markedCells,
                  ]}
                />
                <HiddenInput
                  target={{ kind: "cell", ...editingCell }}
                  box={editingTableBox}
                  transform={transform}
                />
                <SelectionLayer box={editingTableBox} transform={transform} />
                <Cursor box={editingTableBox} transform={transform} />
                <FormatBar
                  runs={editingRuns}
                  lines={editingLines}
                  transform={transform}
                  onFormat={applyFormat}
                  onLines={applyLines}
                />
              </>
            )}
          {editing !== null && editingBox !== null && editingBox.page === currentPage && transform !== null && (
            <>
              <HiddenInput target={{ kind: "element", id: editing }} box={editingBox} transform={transform} />
              <ChipPicker
                text={editingRuns.map((run) => run.text).join("")}
                box={editingBox}
                transform={transform}
              />
              <SelectionLayer box={editingBox} transform={transform} />
              <Cursor box={editingBox} transform={transform} />
              <FormatBar
                runs={editingRuns}
                lines={editingLines}
                transform={transform}
                onFormat={applyFormat}
                onLines={applyLines}
              />
            </>
          )}
          {create.state.phase !== "idle" && transform !== null && (
            <CreatePreview shape={create.state.shape} transform={transform} />
          )}
          {create.state.phase === "needsFont" && (
            <div className="canvas-notice" role="alert" onPointerDown={(event) => event.stopPropagation()}>
              <p>
                {create.state.error ??
                  `El proyecto no tiene ninguna fuente: añade una para poder crear ${
                    create.state.kind === "table" ? "tablas" : "textos"
                  }.`}
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
          {transform !== null &&
            overflowing.map((box) => (
              <OverflowNotice key={box.id} box={box} transform={transform} />
            ))}
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
