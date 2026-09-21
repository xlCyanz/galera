import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AppliedOp, OpenedProject } from "../commands";
import { useDocumentStore } from "../store/document";
import type { Element } from "../types/model";
import { useClipboard } from "./useClipboard";
import { pretendMac } from "./useShortcuts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const rect = (id: string, x: number): Element => ({
  type: "rect", id, x, y: 10, w: 40, h: 20, rotation: 0, fill: "#ff0000", stroke: null, radius: 0,
});

const project: OpenedProject = {
  root: "/p",
  archive: null,
  revision: 1,
  document: {
    version: 1,
    meta: { title: "x" },
    fonts: [],
    assets: {},
    variables: {},
    pages: [{ id: "p1", size: { width: 200, height: 100, unit: "mm" }, elements: [rect("r1", 10)] }],
  },
};

/** El documento como queda tras pegar: con la copia dentro. */
const pasted = structuredClone(project.document);
pasted.pages[0]!.elements.push(rect("r1-2", 15));

function Probe() {
  useClipboard();
  return null;
}

let container: HTMLDivElement;
let root: Root;
/** Lo que se le ha pedido al backend. */
let asked: Array<{ command: string; args: Record<string, unknown> }>;
/** Lo que se ha escrito en el portapapeles del sistema. */
let written: string[];
const restore: Array<() => void> = [];

beforeEach(() => {
  pretendMac(true);
  asked = [];
  written = [];

  const had = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: (text: string) => {
        written.push(text);
        return Promise.resolve();
      },
    },
  });
  restore.push(() => {
    if (had === undefined) {
      delete (navigator as { clipboard?: unknown }).clipboard;
    } else {
      Object.defineProperty(navigator, "clipboard", had);
    }
  });

  mockIPC((command, args) => {
    asked.push({ command, args: args as Record<string, unknown> });
    if (command === "copy_elements") {
      return "Hola";
    }
    if (command === "paste_elements" || command === "duplicate_elements" || command === "apply_op") {
      const applied: AppliedOp = {
        revision: 2,
        document: structuredClone(pasted),
        description: "",
        undo: null,
        redo: null,
      };
      return applied;
    }
    return null;
  });

  useDocumentStore.setState(useDocumentStore.getInitialState(), true);
  useDocumentStore.getState().open(project);

  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<Probe />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  clearMocks();
  while (restore.length > 0) restore.pop()?.();
});

const store = () => useDocumentStore.getState();
const asking = (command: string) => asked.find((one) => one.command === command);

function press(key: string, init: KeyboardEventInit = {}) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
  });
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("el portapapeles", () => {
  /** El criterio de la tarea: ⌘C copia y deja texto plano fuera. */
  it("⌘C copia lo seleccionado y escribe su texto en el portapapeles", async () => {
    act(() => store().select("r1"));
    press("c", { metaKey: true });
    await settle();

    expect(asking("copy_elements")?.args).toEqual({ ids: ["r1"] });
    expect(written).toEqual(["Hola"]);
  });

  it("sin selección no copia nada", async () => {
    press("c", { metaKey: true });
    await settle();
    expect(asking("copy_elements")).toBeUndefined();
  });

  /** El criterio de la tarea: ⌘X corta. */
  it("⌘X copia y borra, con un solo comando", async () => {
    act(() => store().selectMany(["r1", "r2"]));
    press("x", { metaKey: true });
    await settle();

    expect(asking("copy_elements")?.args).toEqual({ ids: ["r1", "r2"] });
    expect(asking("apply_op")?.args).toEqual({
      op: {
        op: "batch",
        ops: [
          { op: "delete", id: "r1" },
          { op: "delete", id: "r2" },
        ],
      },
      group: null,
    });
    expect(store().selection).toEqual([]);
  });

  /** El criterio de la tarea: ⌘V pega en la página que se ve. */
  it("⌘V pega y deja seleccionado lo que aparece", async () => {
    press("v", { metaKey: true });
    await settle();

    expect(asking("paste_elements")?.args).toEqual({ page: "p1", x: null, y: null });
    expect(store().selection).toEqual(["r1-2"]);
  });

  /** El criterio de la tarea: ⌘D duplica. */
  it("⌘D duplica lo seleccionado sin tocar lo copiado", async () => {
    act(() => store().select("r1"));
    press("d", { metaKey: true });
    await settle();

    expect(asking("duplicate_elements")?.args).toEqual({ ids: ["r1"] });
    expect(asking("copy_elements")).toBeUndefined();
    expect(store().selection).toEqual(["r1-2"]);
  });

  it("si el portapapeles del sistema falla, lo de dentro sigue valiendo", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: () => Promise.reject(new Error("sin permiso")),
      },
    });
    act(() => store().select("r1"));
    press("c", { metaKey: true });
    await settle();

    expect(asking("copy_elements")).toBeDefined();
  });
});
