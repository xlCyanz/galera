import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { OpenedProject } from "../commands";
import { useDocumentStore } from "../store/document";
import { useEditingStore } from "../store/editing";
import { applyFormat, applyLines } from "./useTextFormat";

/**
 * Un texto con acentos y un flujo con otro: lo que se manda al núcleo va en
 * caracteres, y ahí «ñ» ocupa uno, no los dos bytes que ocupa en el store.
 */
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
      cuerpo: {
        content: [{ text: "Añadir más", bold: false, italic: false, underline: false }],
        style: { font: "Inter", size: 11, color: "#000000", align: "left", leading: 0.65 },
        zones: ["z1"],
      },
    },
    pages: [
      {
        id: "p1",
        size: { width: 200, height: 100, unit: "mm" },
        elements: [
          {
            type: "text",
            id: "t1",
            x: 10,
            y: 10,
            w: 80,
            h: null,
            rotation: 0,
            content: [{ text: "Añadir", bold: false, italic: false, underline: false }],
            style: { font: "Inter", size: 12, color: "#000000", align: "left", leading: 0.65 },
            lines: [],
          },
          { type: "flow", id: "z1", x: 10, y: 40, w: 80, h: 20, rotation: 0, flow: "cuerpo" },
        ],
      },
    ],
  },
};

let asked: Array<Record<string, unknown>>;

beforeEach(() => {
  asked = [];
  mockIPC((command, args) => {
    if (command === "apply_op") {
      asked.push((args as { op: Record<string, unknown> }).op);
      return {
        revision: 2,
        document: project.document,
        description: "Formato",
        undo: null,
        redo: null,
      };
    }
    return null;
  });
  useDocumentStore.setState(useDocumentStore.getInitialState(), true);
  useEditingStore.setState(useEditingStore.getInitialState(), true);
  useDocumentStore.getState().open(project);
});

afterEach(() => {
  clearMocks();
});

describe("el formato de lo seleccionado", () => {
  /**
   * El store cuenta en bytes, porque es lo que cuentan los glifos; el
   * núcleo cuenta en caracteres. «Añ» son tres bytes y dos caracteres: sin
   * traducir, la negrita se comería la «a» de detrás.
   */
  it("manda el tramo en caracteres, no en bytes", async () => {
    useEditingStore.getState().edit("t1");
    // «Añ»: del byte 0 al 3.
    useEditingStore.getState().select(0, 3);

    await applyFormat({ bold: true });

    expect(asked.at(-1)).toMatchObject({
      op: "format_text",
      id: "t1",
      from: 0,
      to: 2,
    });
  });

  it("y lo mismo en un flujo", async () => {
    useEditingStore.getState().editFlow("cuerpo");
    // «Añadir »: ocho caracteres, nueve bytes.
    useEditingStore.getState().select(0, 9);

    await applyFormat({ italic: true });

    expect(asked.at(-1)).toMatchObject({
      op: "format_flow_text",
      flow: "cuerpo",
      from: 0,
      to: 8,
    });
  });

  it("al revés también, sin importar por dónde se empezó a seleccionar", async () => {
    useEditingStore.getState().edit("t1");
    useEditingStore.getState().select(7, 3);

    await applyFormat({ bold: true });

    expect(asked.at(-1)).toMatchObject({ from: 2, to: 6 });
  });

  it("sin nada seleccionado no manda nada", async () => {
    useEditingStore.getState().edit("t1");
    useEditingStore.getState().select(3, 3);

    await applyFormat({ bold: true });

    expect(asked).toEqual([]);
  });
});

describe("las líneas de lo seleccionado", () => {
  it("también van en caracteres", async () => {
    useEditingStore.getState().edit("t1");
    useEditingStore.getState().select(0, 7);

    await applyLines({ list: "bullet", level: 0 });

    expect(asked.at(-1)).toMatchObject({
      op: "set_lines",
      id: "t1",
      from: 0,
      to: 6,
    });
  });
});
