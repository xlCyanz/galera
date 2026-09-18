import { describe, expect, it } from "vitest";

import { useToolStore } from "../store/tool";
import { TOOLS, TOOL_IDS, createsElements, toolForKey, toolInfo } from "./tools";

const press = (key: string, modifiers: Partial<KeyboardEvent> = {}) => ({
  key,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...modifiers,
});

describe("herramientas", () => {
  it("son siete, cada una con su tecla, sin repetir", () => {
    expect(TOOLS.map((tool) => tool.id)).toEqual([...TOOL_IDS]);
    expect(new Set(TOOLS.map((tool) => tool.key)).size).toBe(7);
    expect(TOOLS.every((tool) => tool.label.length > 0 && tool.key.length === 1)).toBe(true);
  });

  it("una tecla sola activa su herramienta, en mayúscula o minúscula", () => {
    expect(toolForKey(press("v"))).toBe("select");
    expect(toolForKey(press("T"))).toBe("text");
    expect(toolForKey(press("r"))).toBe("rect");
    expect(toolForKey(press("o"))).toBe("ellipse");
    expect(toolForKey(press("l"))).toBe("line");
    expect(toolForKey(press("i"))).toBe("image");
    expect(toolForKey(press("h"))).toBe("hand");
    expect(toolForKey(press("x"))).toBeNull();
  });

  it("con un modificador es otro atajo: ⇧R son las reglas, ⌘R no es el rectángulo", () => {
    expect(toolForKey(press("R", { shiftKey: true }))).toBeNull();
    expect(toolForKey(press("r", { metaKey: true }))).toBeNull();
    expect(toolForKey(press("v", { ctrlKey: true }))).toBeNull();
    expect(toolForKey(press("t", { altKey: true }))).toBeNull();
  });

  it("solo crean elementos las de texto, formas, línea e imagen", () => {
    expect(TOOL_IDS.filter(createsElements)).toEqual(["text", "rect", "ellipse", "line", "image"]);
    expect(toolInfo("hand").cursor).toBe("grab");
  });

  it("tras crear un elemento se vuelve a la de selección", () => {
    useToolStore.getState().setTool("rect");
    expect(useToolStore.getState().tool).toBe("rect");
    useToolStore.getState().created();
    expect(useToolStore.getState().tool).toBe("select");
  });
});
