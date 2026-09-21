import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AppliedOp, OpenedProject } from "../commands";
import { useDocumentStore } from "../store/document";
import { AlignBar } from "./AlignBar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
    pages: [
      {
        id: "p1",
        size: { width: 200, height: 100, unit: "mm" },
        elements: [
          { type: "rect", id: "r1", x: 10, y: 10, w: 40, h: 20, rotation: 0, fill: "#ff0000", stroke: null, radius: 0 },
          { type: "rect", id: "r2", x: 100, y: 50, w: 40, h: 20, rotation: 0, fill: "#00ff00", stroke: null, radius: 0 },
        ],
      },
    ],
  },
};

let container: HTMLDivElement;
let root: Root;
/** Lo que se le ha pedido al núcleo. */
let asked: Array<{ command: string; args: Record<string, unknown> }>;
/** Si el núcleo dice que no había nada que mover. */
let nothing: boolean;

beforeEach(() => {
  asked = [];
  nothing = false;
  mockIPC((command, args) => {
    asked.push({ command, args: args as Record<string, unknown> });
    if (command === "align_elements" || command === "spread_elements") {
      if (nothing) {
        return null;
      }
      const applied: AppliedOp = {
        revision: 2,
        document: structuredClone(project.document),
        description: "Mover r1",
        undo: "Mover r1",
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
  act(() => root.render(<AlignBar />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  clearMocks();
});

const button = (label: string) => container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);
const toggle = () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;

function click(element: HTMLElement | null) {
  act(() => {
    element?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function select(ids: string[]) {
  act(() => useDocumentStore.getState().selectMany(ids));
}

describe("la barra de alinear", () => {
  it("sin selección no se enseña", () => {
    expect(container.querySelector(".align-bar")).toBeNull();
  });

  /** El criterio de la tarea: las seis alineaciones. */
  it("tiene las seis alineaciones y los dos repartos", () => {
    select(["r1", "r2"]);
    for (const label of [
      "Alinear a la izquierda",
      "Centrar en horizontal",
      "Alinear a la derecha",
      "Alinear arriba",
      "Centrar en vertical",
      "Alinear abajo",
      "Repartir en horizontal",
      "Repartir en vertical",
    ]) {
      expect(button(label), label).not.toBeNull();
    }
  });

  it("alinear manda al núcleo lo seleccionado y cómo", async () => {
    select(["r1", "r2"]);
    click(button("Alinear a la izquierda"));
    await settle();

    const asking = asked.find((one) => one.command === "align_elements");
    expect(asking?.args).toEqual({ ids: ["r1", "r2"], how: "left", toPage: false });
    // Y el documento que devuelve entra en el store, con su historial.
    expect(useDocumentStore.getState().history.undo).toBe("Mover r1");
  });

  it("repartir manda el eje", async () => {
    select(["r1", "r2"]);
    click(button("Repartir en vertical"));
    await settle();

    const asking = asked.find((one) => one.command === "spread_elements");
    expect(asking?.args).toEqual({ ids: ["r1", "r2"], axis: "vertical", toPage: false });
  });

  /** El criterio de la tarea: se puede alinear respecto a la página. */
  it("con el interruptor se alinea respecto a la página", async () => {
    select(["r1", "r2"]);
    click(toggle());
    click(button("Alinear arriba"));
    await settle();

    const asking = asked.find((one) => one.command === "align_elements");
    expect(asking?.args).toMatchObject({ how: "top", toPage: true });
  });

  it("con un solo elemento solo cabe la página, y no se reparte nada", () => {
    select(["r1"]);
    expect(toggle().checked).toBe(true);
    expect(toggle().disabled).toBe(true);
    expect(button("Repartir en horizontal")?.disabled).toBe(true);
    expect(button("Alinear a la izquierda")?.disabled).toBeFalsy();
  });

  it("si no había nada que mover, no se toca el documento", async () => {
    nothing = true;
    select(["r1", "r2"]);
    click(button("Alinear abajo"));
    await settle();

    expect(useDocumentStore.getState().history.undo).toBeNull();
  });
});
