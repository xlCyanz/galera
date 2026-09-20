import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AppliedOp, OpenedProject } from "../commands";
import { canvasTransform } from "../canvas/transform";
import { useDocumentStore } from "../store/document";
import { useEditingStore } from "../store/editing";
import type { LayoutBox } from "../types/layout";
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
};

const transform = canvasTransform({ width: 800, height: 600 }, { width: 210, height: 297, unit: "mm" }, 1, {
  x: 0,
  y: 0,
});

let container: HTMLDivElement;
let root: Root;
/** Los comandos que llegaron al backend. */
let calls: Array<{ command: string; args: Record<string, unknown> }>;
/** Si `apply_op` tiene que fallar. */
let refuse: boolean;

beforeEach(() => {
  calls = [];
  refuse = false;
  mockIPC((command, args) => {
    calls.push({ command, args: args as Record<string, unknown> });
    if (command === "apply_op") {
      if (refuse) {
        throw { kind: "op", message: "no" };
      }
      const op = (args as { op: { property: { value: Run[] } } }).op;
      const document = structuredClone(useDocumentStore.getState().document!);
      const element = document.pages[0]!.elements[0]!;
      if (element.type === "text") {
        element.content = op.property.value;
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
  act(() => root.render(<HiddenInput id="t1" box={box} transform={transform} />));
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
    .map((call) => call.args as { op: { property: { value: Run[] } }; group: string | null });

const content = () => {
  const element = useDocumentStore.getState().document?.pages[0]?.elements[0];
  return element?.type === "text" ? element.content : [];
};

/** Escribe en el campo como lo haría el navegador. */
async function type(text: string) {
  await act(async () => {
    field().value = text;
    field().dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();
  });
}

async function key(init: KeyboardEventInit) {
  await act(async () => {
    field().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
    await Promise.resolve();
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

  it("escribir manda el contenido y conserva el formato de los tramos", async () => {
    await type("Hola mundos");
    expect(ops()).toHaveLength(1);
    expect(content()).toEqual([
      { text: "Hola ", bold: false, italic: false, underline: false },
      { text: "mundos", bold: true, italic: false, underline: false },
    ]);
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
    expect(content().map((run) => run.text).join("")).toBe("Hola mundoé");
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
      await Promise.resolve();
    });
    expect(field().value).toBe("Hola mundoy más");
    expect(content().map((run) => run.text).join("")).toBe("Hola mundoy más");

    await act(async () => {
      field().dispatchEvent(paste({ "text/plain": "!", "text/html": "<b>!</b>" }));
      await Promise.resolve();
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
      await Promise.resolve();
    });
    expect(field().value).toBe("Otro texto");
  });

  it("si el texto desaparece, se deja de escribir", async () => {
    await act(async () => {
      const document = structuredClone(useDocumentStore.getState().document!);
      document.pages[0]!.elements = [];
      useDocumentStore.getState().replaceDocument(document);
      await Promise.resolve();
    });
    expect(useEditingStore.getState().element).toBeNull();
  });

  it("si el núcleo lo rechaza, la copia vuelve a lo que hay", async () => {
    refuse = true;
    await type("Hola mundos");
    await act(async () => {
      await Promise.resolve();
    });
    expect(field().value).toBe("Hola mundo");
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
