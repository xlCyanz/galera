/**
 * Insertar imágenes: soltándolas desde el sistema sobre la ventana o con la
 * herramienta de imagen, que abre el diálogo nativo.
 *
 * El backend copia cada archivo en `assets/` del proyecto y lo registra en
 * el documento (`importImages`, `chooseImages`). Después se crea un
 * elemento por imagen en el punto donde se soltó o se hizo clic, con su
 * proporción original (`insertImages.ts`). Todas las de una vez son un
 * único paso del historial, y la última queda seleccionada.
 *
 * Lo que no se puede añadir (un PDF, un formato que Typst no dibuja) se
 * dice con un mensaje en el lienzo; el resto se inserta igual.
 */
import { type PointerEvent, type RefObject, useEffect, useEffectEvent, useRef, useState } from "react";

import {
  type FileDrop,
  type ImportedImages,
  applyOp,
  chooseImages,
  errorMessage,
  importImages,
  subscribeToFileDrops,
} from "../commands";
import { useDocumentStore } from "../store/document";
import { useToolStore } from "../store/tool";
import { toMillimeters } from "./geometry";
import { imageElements } from "./insertImages";
import { type CanvasTransform, toDocument } from "./transform";

export interface FileDropHandle {
  /** Si se está arrastrando algo del sistema sobre la ventana. */
  over: boolean;
  /** Por qué no se pudo insertar algo. Vacío si todo fue bien. */
  messages: string[];
  /** Quita los mensajes. */
  dismiss: () => void;
  /** Con la herramienta de imagen: pide imágenes y las inserta donde se pulsó. */
  insertFromDialog: (event: PointerEvent<HTMLElement>) => void;
  /** Lo mismo sin puntero: el diálogo de elegir imágenes, y se ponen con
   * la esquina en `at`, en mm (F8-02). */
  insertAt: (at: { x: number; y: number }) => void;
}

let batches = 0;

/**
 * @param viewport El área del lienzo, para pasar la posición a milímetros.
 * @param transform Dónde está la página visible y a qué escala.
 * @param page La página visible, contando desde 0.
 * @param subscribe Cómo escuchar lo que se suelta; solo se cambia en pruebas.
 */
export function useFileDrop(
  viewport: RefObject<HTMLElement | null>,
  transform: CanvasTransform | null,
  page: number,
  subscribe: (handler: (drop: FileDrop) => void) => Promise<() => void> = subscribeToFileDrops,
): FileDropHandle {
  const [over, setOver] = useState(false);
  const [messages, setMessages] = useState<string[]>([]);
  const busy = useRef(false);

  /**
   * Un punto de la pantalla en mm de la página, o `null` si cae fuera del
   * lienzo: lo que se suelta en otro sitio (el panel de recursos, por
   * ejemplo) no es para el lienzo.
   */
  const pointAt = useEffectEvent((clientX: number, clientY: number) => {
    const area = viewport.current?.getBoundingClientRect();
    if (transform === null || area === undefined) {
      return null;
    }
    const inside =
      clientX >= area.left && clientX <= area.right && clientY >= area.top && clientY <= area.bottom;
    return inside ? toDocument(transform, clientX - area.left, clientY - area.top) : null;
  });

  /** Crea los elementos de lo que el backend ya añadió al proyecto. */
  const insert = useEffectEvent(async (imported: ImportedImages, at: { x: number; y: number }) => {
    setMessages(imported.rejected.map((rejected) => rejected.message));
    if (imported.applied === null || imported.images.length === 0) {
      return;
    }
    const store = useDocumentStore.getState();
    store.applyEdit(imported.applied);
    const document = useDocumentStore.getState().document;
    const target = document?.pages[page];
    if (document === null || target === undefined) {
      return;
    }
    const width = toMillimeters(target.size.width, target.size.unit);
    const elements = imageElements(document, imported.images, at, width);
    batches += 1;
    const group = `insert-images-${batches}`;
    for (const element of elements) {
      const applied = await applyOp({ op: "create", page: target.id, index: null, element }, group);
      useDocumentStore.getState().applyEdit(applied);
    }
    const last = elements.at(-1);
    if (last !== undefined) {
      useDocumentStore.getState().select(last.id);
    }
    useToolStore.getState().created();
  });

  /** Lo que se haga, una cosa a la vez y con los errores como mensaje. */
  const run = useEffectEvent(async (work: () => Promise<void>) => {
    if (busy.current) {
      return;
    }
    busy.current = true;
    try {
      await work();
    } catch (reason) {
      setMessages([errorMessage(reason)]);
    } finally {
      busy.current = false;
    }
  });

  const onDrop = useEffectEvent((drop: FileDrop) => {
    if (drop.type !== "drop") {
      setOver(drop.type === "over" && pointAt(drop.x, drop.y) !== null);
      return;
    }
    setOver(false);
    const at = pointAt(drop.x, drop.y);
    if (at === null || drop.paths.length === 0 || useDocumentStore.getState().document === null) {
      return;
    }
    void run(async () => insert(await importImages(drop.paths), at));
  });

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let gone = false;
    subscribe((drop) => onDrop(drop))
      .then((stop) => {
        if (gone) {
          stop();
        } else {
          unlisten = stop;
        }
      })
      .catch(() => undefined);
    return () => {
      gone = true;
      unlisten?.();
    };
  }, [subscribe]);

  return {
    over,
    messages,
    dismiss: () => setMessages([]),
    insertFromDialog: (event) => {
      if (event.button !== 0 || event.defaultPrevented) {
        return;
      }
      event.preventDefault();
      const at = pointAt(event.clientX, event.clientY);
      if (at === null) {
        return;
      }
      void run(async () => insert(await chooseImages(), at));
    },
    insertAt: (at) => {
      void run(async () => insert(await chooseImages(), at));
    },
  };
}
