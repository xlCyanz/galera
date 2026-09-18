import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AppliedOp, FontInfo, OpenedProject } from "../commands";
import { useDocumentStore } from "../store/document";
import type { Document } from "../types/model";
import { FontSelect } from "./FontSelect";
import { FontsPanel } from "./FontsPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const text = {
  type: "text" as const,
  id: "t1",
  x: 0,
  y: 0,
  w: 50,
  h: null,
  rotation: 0,
  content: [],
  style: { font: "Inter", size: 12, color: "#000000", align: "left" as const, leading: 0.65 },
};

const project: OpenedProject = {
  root: "/p",
  revision: 1,
  document: {
    version: 1,
    meta: { title: "x" },
    fonts: ["fonts/Inter-Regular.ttf", "fonts/Lora.ttf"],
    assets: {},
    variables: {},
    pages: [{ id: "p1", size: { width: 10, height: 10, unit: "mm" }, elements: [text] }],
  },
};

let container: HTMLDivElement;
let root: Root;
let calls: Array<{ command: string; args: unknown }>;
let addAnswer: () => unknown;

const withFonts = (fonts: string[]): Document => ({ ...structuredClone(useDocumentStore.getState().document!), fonts });

beforeEach(async () => {
  calls = [];
  addAnswer = () => null;
  URL.createObjectURL = () => "blob:muestra";
  URL.revokeObjectURL = () => undefined;
  mockIPC((command, args) => {
    calls.push({ command, args });
    const document = useDocumentStore.getState().document!;
    if (command === "list_fonts") {
      return document.fonts.map((path): FontInfo => ({
        path,
        families: path.includes("Inter") ? ["Inter"] : ["Lora"],
        bytes: 310_000,
        users: path.includes("Inter") ? ["t1"] : [],
      }));
    }
    if (command === "font_families") {
      return ["Inter", "Lora"];
    }
    if (command === "font_sample") {
      return "<svg/>";
    }
    if (command === "remove_font") {
      const { path } = args as { path: string };
      if (path.includes("Inter")) {
        throw { kind: "font_in_use", message: `la fuente ${path} la usa t1: cambia su tipografía antes de quitarla` };
      }
      const applied: AppliedOp = {
        revision: 2,
        document: withFonts(document.fonts.filter((font) => font !== path)),
        description: "x",
        undo: "Quitar la fuente Lora.ttf",
        redo: null,
      };
      return applied;
    }
    if (command === "add_font") {
      return addAnswer();
    }
    if (command === "apply_op") {
      const { op } = args as { op: { property: { value: typeof text.style } } };
      const next = structuredClone(document);
      (next.pages[0]!.elements[0] as typeof text).style = op.property.value;
      const applied: AppliedOp = { revision: 3, document: next, description: "x", undo: "x", redo: null };
      return applied;
    }
    return null;
  });
  useDocumentStore.setState(useDocumentStore.getInitialState(), true);
  useDocumentStore.getState().open(project);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  act(() => root.unmount());
  container.remove();
  await settle();
  clearMocks();
});

async function settle() {
  await act(async () => {
    for (let i = 0; i < 4; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}

async function render(node: React.ReactNode) {
  act(() => root.render(node));
  await settle();
}

const row = (path: string) => container.querySelector<HTMLElement>(`[data-font="${path}"]`)!;
const message = () => container.querySelector(".assets-message")?.textContent ?? null;

describe("panel de fuentes", () => {
  it("lista las fuentes del documento con su muestra de Typst, familias, peso y uso", async () => {
    await render(<FontsPanel />);
    expect(row("fonts/Inter-Regular.ttf").querySelector("img")?.getAttribute("src")).toBe("blob:muestra");
    expect(calls.filter((c) => c.command === "font_sample").map((c) => c.args)).toEqual([
      { path: "fonts/Inter-Regular.ttf" },
      { path: "fonts/Lora.ttf" },
    ]);
    expect(row("fonts/Inter-Regular.ttf").textContent).toContain("Inter");
    expect(row("fonts/Inter-Regular.ttf").textContent).toContain("Inter-Regular.ttf · 302,7 KB · en uso (1)");
  });

  it("quitar una en uso avisa y dice qué textos la usan; una sin usar se quita", async () => {
    await render(<FontsPanel />);
    await act(async () => {
      row("fonts/Inter-Regular.ttf").querySelector<HTMLButtonElement>(".asset-remove")!.click();
    });
    await settle();
    expect(message()).toContain("la usa t1");
    expect(useDocumentStore.getState().document!.fonts).toHaveLength(2);

    await act(async () => {
      row("fonts/Lora.ttf").querySelector<HTMLButtonElement>(".asset-remove")!.click();
    });
    await settle();
    expect(useDocumentStore.getState().document!.fonts).toEqual(["fonts/Inter-Regular.ttf"]);
    expect(container.querySelector('[data-font="fonts/Lora.ttf"]')).toBeNull();
    expect(useDocumentStore.getState().history.undo).toBe("Quitar la fuente Lora.ttf");
  });

  it("Añadir… declara la fuente elegida; lo que no es una fuente se dice", async () => {
    await render(<FontsPanel />);
    const add = () => [...container.querySelectorAll("button")].find((b) => b.textContent === "Añadir…")!;

    addAnswer = () => {
      throw { kind: "font", message: "falsa.ttf no es una fuente que Galera sepa leer (TTF, OTF o una colección TTC)" };
    };
    await act(async () => add().click());
    await settle();
    expect(message()).toContain("no es una fuente");

    addAnswer = () => ({
      revision: 5,
      document: withFonts([...useDocumentStore.getState().document!.fonts, "fonts/Nueva.otf"]),
      description: "x",
      undo: null,
      redo: null,
    });
    await act(async () => add().click());
    await settle();
    expect(message()).toBeNull();
    expect(row("fonts/Nueva.otf")).not.toBeNull();
  });
});

describe("selector de fuente del inspector", () => {
  it("solo ofrece las fuentes del proyecto y cambiarla manda el estilo nuevo", async () => {
    await render(<FontSelect id="t1" style={text.style} />);
    const select = container.querySelector<HTMLSelectElement>("select")!;
    expect([...select.options].map((option) => option.value)).toEqual(["Inter", "Lora"]);
    await act(async () => {
      select.value = "Lora";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    const op = calls.find((c) => c.command === "apply_op")?.args as { op: unknown };
    expect(op.op).toEqual({ op: "set_property", id: "t1", property: { name: "style", value: { ...text.style, font: "Lora" } } });
  });

  it("una fuente que el proyecto no trae se enseña marcada, sin poder elegirla", async () => {
    await render(<FontSelect id="t1" style={{ ...text.style, font: "Comic Sans" }} />);
    const options = [...container.querySelectorAll("option")];
    expect(options[0]!.textContent).toBe("Comic Sans (no está en el proyecto)");
    expect(options[0]!.disabled).toBe(true);
  });
});
