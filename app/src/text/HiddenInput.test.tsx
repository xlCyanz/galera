import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AppliedOp, OpenedProject } from "../commands";
import { canvasTransform } from "../canvas/transform";
import { useDocumentStore } from "../store/document";
import { useEditingStore } from "../store/editing";
import type { Glyph, LayoutBox } from "../types/layout";
import type { Run } from "../types/model";
import { HiddenInput } from "./HiddenInput";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const runs: Run[] = [
  { text: "Hola ", bold: false, italic: false, underline: false },
  { text: "mundo", bold: true, italic: false, underline: false },
];

const project = (): OpenedProject => ({
  root: "/p",
  revision: 1,
  archive: null,
  document: {
    version: 1,
    meta: { title: "x" },
    fonts: ["fonts/Inter-Regular.ttf"],
    assets: {},
    variables: {},
    pages: [
      {
        id: "p1",
        size: { width: 210, height: 297, unit: "mm" },
        elements: [
          {
            type: "text",
            id: "t1",
            x: 20,
            y: 20,
            w: 100,
            h: null,
            rotation: 0,
            content: structuredClone(runs),
            style: {
              font: "Inter",
              size: 12,
              color: "#000000",
              align: "left",
              leading: 0.65,
            },
          },
        ],
      },
    ],
  },
});

const box: LayoutBox = {
  id: "t1",
  page: 0,
  x: 20,
  y: 20,
  w: 100,
  h: 10,
  rotation: 0,
  bounds: { x: 20, y: 20, w: 100, h: 10 },
  line: null,
  overflow: 0,
};

const transform = canvasTransform({ width: 800, height: 600 }, { width: 210, height: 297, unit: "mm" }, 1, {
  x: 0,
  y: 0,
});

/** Los comandos de texto que manda el campo. */
type TextOp =
  | { op: "insert_text"; id: string; at: number; text: string }
  | { op: "delete_text"; id: string; from: number; to: number };

/** Dónde empieza cada carácter, en unidades de JavaScript. */
const starts = (text: string) => [
  ...[...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].map(
    (segment) => segment.index,
  ),
  text.length,
];

function applyToText(text: string, op: TextOp): string {
  const bounds = starts(text);
  if (op.op === "insert_text") {
    const at = bounds[op.at] ?? text.length;
    return text.slice(0, at) + op.text + text.slice(at);
  }
  const from = bounds[op.from] ?? text.length;
  const to = bounds[op.to] ?? text.length;
  return text.slice(0, from) + text.slice(to);
}

let container: HTMLDivElement;
let root: Root;
/** Los comandos que llegaron al backend. */
let calls: Array<{ command: string; args: Record<string, unknown> }>;
/** Si `apply_op` tiene que fallar. */
let refuse: boolean;
/** Los glifos que devuelve el backend. */
let scene: Glyph[];

beforeEach(() => {
  calls = [];
  refuse = false;
  scene = [];
  mockIPC((command, args) => {
    calls.push({ command, args: args as Record<string, unknown> });
    if (command === "glyphs") {
      return scene;
    }
    if (command === "apply_op") {
      if (refuse) {
        throw { kind: "op", message: "no" };
      }
      // El núcleo de mentira: aplica el comando al texto entero. El reparto
      // en tramos de verdad se prueba en Rust (`model::text`).
      const op = (args as { op: TextOp }).op;
      const document = structuredClone(useDocumentStore.getState().document!);
      const element = document.pages[0]!.elements[0]!;
      if (element.type === "text") {
        element.content = [
          {
            text: applyToText(element.content.map((run) => run.text).join(""), op),
            bold: false,
            italic: false,
            underline: false,
          },
        ];
      }
      const applied: AppliedOp = {
        revision: 2,
        document,
        description: "Cambiar el texto",
        undo: "Cambiar el texto",
        redo: null,
      };
      return applied;
    }
    return null;
  });
  useDocumentStore.setState(useDocumentStore.getInitialState(), true);
  useEditingStore.setState(useEditingStore.getInitialState(), true);
  useDocumentStore.getState().open(project());
  useEditingStore.getState().edit("t1", 10);
  container = window.document.createElement("div");
  window.document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<HiddenInput target={{ kind: "element", id: "t1" }} box={box} transform={transform} />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  clearMocks();
});

const field = () => container.querySelector("textarea")!;

const ops = () =>
  calls
    .filter((call) => call.command === "apply_op")
    .map((call) => call.args as { op: TextOp; group: string | null });

const content = () => {
  const element = useDocumentStore.getState().document?.pages[0]?.elements[0];
  return element?.type === "text" ? element.content : [];
};

const text = () => content().map((run) => run.text).join("");

/** Escribe en el campo como lo haría el navegador. */
async function type(text: string) {
  await act(async () => {
    field().value = text;
    field().dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
  });
}

/** Espera a que los comandos de camino al backend lleguen y vuelvan. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

async function key(init: KeyboardEventInit) {
  await act(async () => {
    field().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
    await settle();
  });
}

describe("el campo invisible", () => {
  it("toma el foco con el texto del documento y el cursor al final", () => {
    expect(field().value).toBe("Hola mundo");
    expect(window.document.activeElement).toBe(field());
    expect(field().selectionStart).toBe(10);
    expect(useEditingStore.getState().start).toBe(10);
    expect(field().getAttribute("aria-label")).toBe("Texto de t1");
  });

  it("escribir manda un comando con la posición en caracteres", async () => {
    await type("Hola mundos");
    expect(ops().map((call) => call.op)).toEqual([
      { op: "insert_text", id: "t1", at: 10, text: "s" },
    ]);
    expect(text()).toBe("Hola mundos");
  });

  it("borrar manda el trozo que se quita, y cambiar lo seleccionado manda los dos", async () => {
    await type("Hola");
    expect(ops().map((call) => call.op)).toEqual([{ op: "delete_text", id: "t1", from: 4, to: 10 }]);

    calls = [];
    await type("Hola tú");
    expect(ops().map((call) => call.op)).toEqual([{ op: "insert_text", id: "t1", at: 4, text: " tú" }]);
  });

  it("un emoji va como un solo carácter", async () => {
    await type("Hola mundo 👩‍🌾");
    expect(ops().map((call) => call.op)).toEqual([
      { op: "insert_text", id: "t1", at: 10, text: " 👩‍🌾" },
    ]);
    expect(text()).toBe("Hola mundo 👩‍🌾");

    calls = [];
    await type("Hola mundo ");
    // Once unidades UTF-16, un solo carácter: de la 11 a la 12.
    expect(ops().map((call) => call.op)).toEqual([{ op: "delete_text", id: "t1", from: 11, to: 12 }]);
  });

  it("teclear seguido es un solo paso del historial", async () => {
    await type("Hola mundos");
    await type("Hola mundoso");
    const groups = ops().map((call) => call.group);
    expect(groups[0]).not.toBeNull();
    expect(groups[1]).toBe(groups[0]);
  });

  it("mientras se compone no se manda nada; al confirmar, una sola vez", async () => {
    await act(async () => {
      field().dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    });
    await type("Hola mundo´");
    await type("Hola mundoé");
    expect(ops()).toHaveLength(0);

    await act(async () => {
      field().value = "Hola mundoé";
      field().dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "é" }));
      await Promise.resolve();
    });
    expect(ops()).toHaveLength(1);
    expect(text()).toBe("Hola mundoé");
  });

  it("lo que se pega entra como texto, y el HTML se queda sin etiquetas", async () => {
    const paste = (types: Record<string, string>) => {
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", {
        value: { getData: (type: string) => types[type] ?? "" },
      });
      return event;
    };

    await act(async () => {
      field().setSelectionRange(10, 10);
      field().dispatchEvent(paste({ "text/html": "<p>y <b>más</b></p>" }));
      await settle();
    });
    expect(field().value).toBe("Hola mundoy más");
    expect(text()).toBe("Hola mundoy más");

    await act(async () => {
      field().dispatchEvent(paste({ "text/plain": "!", "text/html": "<b>!</b>" }));
      await settle();
    });
    expect(field().value).toBe("Hola mundoy más!");
  });

  it("Escape sale de escribir, y también perder el foco", async () => {
    await key({ key: "Escape" });
    expect(useEditingStore.getState().element).toBeNull();

    useEditingStore.getState().edit("t1");
    await act(async () => {
      field().dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(useEditingStore.getState().element).toBeNull();
  });

  it("⌘Z deshace el documento, no el campo", async () => {
    await key({ key: "z", metaKey: true });
    // Sin nada que deshacer el backend no recibe nada; con historial, sí.
    expect(calls.some((call) => call.command === "undo")).toBe(false);

    await type("Hola mundos");
    await key({ key: "z", metaKey: true });
    expect(calls.some((call) => call.command === "undo")).toBe(true);
  });

  it("un cambio que llega de fuera pone la copia al día", async () => {
    await act(async () => {
      const document = structuredClone(useDocumentStore.getState().document!);
      const element = document.pages[0]!.elements[0]!;
      if (element.type === "text") {
        element.content = [{ text: "Otro texto", bold: false, italic: false, underline: false }];
      }
      useDocumentStore.getState().replaceDocument(document);
      await settle();
    });
    expect(field().value).toBe("Otro texto");
  });

  it("si el texto desaparece, se deja de escribir", async () => {
    await act(async () => {
      const document = structuredClone(useDocumentStore.getState().document!);
      document.pages[0]!.elements = [];
      useDocumentStore.getState().replaceDocument(document);
      await settle();
    });
    expect(useEditingStore.getState().element).toBeNull();
  });

  it("si el núcleo lo rechaza, la copia vuelve a lo que hay", async () => {
    refuse = true;
    await type("Hola mundos");
    await act(async () => {
      await settle();
    });
    expect(field().value).toBe("Hola mundo");
  });

  it("lo que selecciona el ratón se aplica al campo: escribir lo sustituye", async () => {
    await act(async () => {
      useEditingStore.getState().select(0, 4);
      await settle();
    });
    expect([field().selectionStart, field().selectionEnd]).toEqual([0, 4]);

    calls = [];
    await type("Adiós mundo");
    expect(ops().map((call) => call.op)).toEqual([
      { op: "delete_text", id: "t1", from: 0, to: 4 },
      { op: "insert_text", id: "t1", at: 0, text: "Adiós" },
    ]);
  });

  it("mover el cursor se guarda para poder dibujarlo", async () => {
    await act(async () => {
      field().setSelectionRange(0, 4);
      field().dispatchEvent(new Event("select", { bubbles: true }));
    });
    expect(useEditingStore.getState().start).toBe(0);
    expect(useEditingStore.getState().end).toBe(4);
  });
});

describe("el tabulador dentro de una lista", () => {
  /** Pone el documento con las líneas que se digan. */
  function withLines(lines: Array<Record<string, unknown>>) {
    act(() => {
      const document = structuredClone(useDocumentStore.getState().document!);
      const element = document.pages[0]!.elements[0]!;
      if (element.type === "text") {
        element.content = [{ text: "Hola\nmundo", bold: false, italic: false, underline: false }];
        element.lines = lines as never;
      }
      useDocumentStore.getState().replaceDocument(document);
    });
  }

  it("Tab anida y ⇧Tab desanida las líneas que toca", async () => {
    withLines([{ list: "bullet" }]);
    act(() => {
      field().setSelectionRange(1, 1);
      // En el navegador lo apunta `selectionchange`; en jsdom, no.
      useEditingStore.getState().setSelection(1, 1);
    });
    await key({ key: "Tab" });
    expect(ops().map((call) => call.op)).toEqual([
      { op: "set_lines", id: "t1", from: 1, to: 1, line: { list: "bullet", level: 1 } },
    ]);

    calls = [];
    withLines([{ list: "bullet", level: 1 }]);
    act(() => useEditingStore.getState().setSelection(1, 1));
    await key({ key: "Tab", shiftKey: true });
    expect(ops().map((call) => call.op)).toEqual([
      { op: "set_lines", id: "t1", from: 1, to: 1, line: { list: "bullet", level: 0 } },
    ]);
  });

  it("fuera de una lista no manda nada, pero tampoco se lleva el foco", async () => {
    withLines([]);
    await key({ key: "Tab" });
    expect(ops()).toHaveLength(0);
    expect(document.activeElement).toBe(field());
  });
});

describe("subir y bajar de línea", () => {
  /** «Hola mundo» partido: «Hola » en la primera línea y «mundo» en la
   * segunda, con glifos de 5 mm. El espacio no se dibuja. */
  const wrapped: Glyph[] = [0, 1, 2, 3, 5, 6, 7, 8, 9].map((text_index, at) => {
    const line = text_index < 5 ? 0 : 1;
    const column = line === 0 ? at : at - 4;
    return {
      page: 0,
      text_index,
      line,
      x: 20 + column * 5,
      y: 20 + line * 6,
      width: 5,
      line_height: 5,
      baseline: 24 + line * 6,
    };
  });

  beforeEach(async () => {
    await act(async () => {
      await settle();
    });
    act(() => useEditingStore.getState().setGlyphs(wrapped));
  });

  const caret = () => [field().selectionStart, field().selectionEnd];

  it("bajar conserva la columna, aunque el campo tenga otras líneas", async () => {
    act(() => field().setSelectionRange(1, 1));
    await key({ key: "ArrowUp" });
    expect(caret()).toEqual([1, 1]);

    await key({ key: "ArrowDown" });
    // La columna de la «o» de «Hola» cae en la «u» de «mundo».
    expect(caret()).toEqual([6, 6]);
    expect(useEditingStore.getState().start).toBe(6);
  });

  it("subir vuelve a la misma columna", async () => {
    act(() => field().setSelectionRange(7, 7));
    await key({ key: "ArrowUp" });
    expect(caret()).toEqual([2, 2]);
  });

  it("la columna se conserva entre saltos", async () => {
    act(() => field().setSelectionRange(10, 10));
    await key({ key: "ArrowUp" });
    await key({ key: "ArrowDown" });
    expect(caret()).toEqual([10, 10]);
  });

  it("con ⇧ se selecciona hasta donde se llega", async () => {
    act(() => field().setSelectionRange(1, 1));
    await key({ key: "ArrowDown", shiftKey: true });
    expect(caret()).toEqual([1, 6]);
  });

  it("escribir reinicia el parpadeo", async () => {
    const before = useEditingStore.getState().typedAt;
    await type("Hola mundos");
    expect(useEditingStore.getState().typedAt).not.toBe(before);
  });
});
