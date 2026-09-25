import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AppliedOp, OpenedProject } from "../commands";
import { useDocumentStore } from "../store/document";
import { Inspector } from "./Inspector";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const style = { font: "Inter", size: 11, color: "#000000", align: "left", leading: 0.65 } as const;
const zone = (id: string, flow: string, y: number) => ({ type: "flow" as const, id, x: 20, y, w: 80, h: 60, rotation: 0, flow });

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
    flows: {
      cuerpo: { content: [], style, zones: ["z1", "z2", "z3"] },
      nota: { content: [], style, zones: ["n1"] },
    },
    pages: [
      {
        id: "p1",
        size: { width: 210, height: 297, unit: "mm" },
        elements: [zone("z1", "cuerpo", 20), zone("z2", "cuerpo", 90), zone("z3", "cuerpo", 160), zone("n1", "nota", 230)],
      },
    ],
  },
};

let container: HTMLDivElement;
let root: Root;
let ops: unknown[];

beforeEach(() => {
  ops = [];
  mockIPC((command, args) => {
    if (command === "apply_op") {
      ops.push((args as { op: unknown }).op);
      const applied: AppliedOp = { revision: 2, document: structuredClone(project.document), description: "", undo: "x", redo: null };
      return applied;
    }
    return null;
  });
  useDocumentStore.setState(useDocumentStore.getInitialState(), true);
  useDocumentStore.getState().open(project);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<Inspector />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  clearMocks();
});

const unlinkButton = () =>
  [...container.querySelectorAll("button")].find((button) => button.textContent === "Sacar de la cadena");

describe("el inspector de una zona de texto", () => {
  it("dice qué puesto ocupa en la cadena de su texto", () => {
    act(() => useDocumentStore.getState().select("z2"));
    expect(container.textContent).toContain("Zona 2 de 3 del texto «cuerpo».");
    expect(container.textContent).toContain("con esta seleccionada dibuja otra");
  });

  it("sacarla de la cadena la pasa a un texto suyo, con un nombre libre", async () => {
    act(() => useDocumentStore.getState().select("z2"));
    await act(async () => {
      unlinkButton()!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(ops).toEqual([{ op: "unlink_zone", zone: "z2", to: "flujo-1" }]);
  });

  it("si está sola en su cadena, no hay nada de lo que sacarla", () => {
    act(() => useDocumentStore.getState().select("n1"));
    expect(container.textContent).toContain("Zona 1 de 1 del texto «nota».");
    expect(unlinkButton()).toBeUndefined();
  });
});
