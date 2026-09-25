import { describe, expect, it } from "vitest";

import { useToolStore } from "../store/tool";
import { shortcutFor, shortcutLabel } from "../shortcuts";
import { TOOLS, TOOL_IDS, createsElements, isShapeTool, toolInfo } from "./tools";

const press = (key: string, modifiers: Partial<KeyboardEvent> = {}) => ({
  key,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...modifiers,
});

describe("herramientas", () => {
  it("son nueve, cada una con su atajo, sin repetir", () => {
    expect(TOOLS.map((tool) => tool.id)).toEqual([...TOOL_IDS]);
    expect(new Set(TOOLS.map((tool) => tool.shortcut)).size).toBe(TOOLS.length);
    expect(TOOLS.every((tool) => tool.label.length > 0)).toBe(true);
    // Cada atajo es una tecla suelta.
    expect(TOOLS.map((tool) => shortcutLabel(tool.shortcut, true))).toEqual([
      "V",
      "T",
      "R",
      "O",
      "L",
      "I",
      "C",
      "B",
      "H",
    ]);
  });

  it("una tecla sola activa su herramienta, en mayúscula o minúscula", () => {
    expect(shortcutFor(press("v"), true)).toBe("toolSelect");
    expect(shortcutFor(press("T"), true)).toBe("toolText");
    expect(shortcutFor(press("h"), true)).toBe("toolHand");
    expect(shortcutFor(press("x"), true)).toBeNull();
  });

  it("con un modificador es otro atajo: ⇧R son las reglas, ⌘R no es el rectángulo", () => {
    expect(shortcutFor(press("R", { shiftKey: true }), true)).toBe("toggleRulers");
    expect(shortcutFor(press("r", { metaKey: true }), true)).toBeNull();
    expect(shortcutFor(press("v", { ctrlKey: true }), true)).toBeNull();
    expect(shortcutFor(press("t", { altKey: true }), true)).toBeNull();
  });

  it("solo crean elementos las de texto, formas, línea, imagen, código y tabla", () => {
    expect(TOOL_IDS.filter(createsElements)).toEqual(["text", "rect", "ellipse", "line", "image", "code", "table"]);
    // Todas arrastrando, menos la imagen, que abre un diálogo.
    expect(TOOL_IDS.filter(isShapeTool)).toEqual(["text", "rect", "ellipse", "line", "code", "table"]);
    expect(toolInfo("hand").cursor).toBe("grab");
  });

  it("tras crear un elemento se vuelve a la de selección", () => {
    useToolStore.getState().setTool("rect");
    expect(useToolStore.getState().tool).toBe("rect");
    useToolStore.getState().created();
    expect(useToolStore.getState().tool).toBe("select");
  });
});
