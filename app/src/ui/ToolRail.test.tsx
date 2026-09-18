import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useToolStore } from "../store/tool";
import { ToolRail } from "./ToolRail";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  useToolStore.setState(useToolStore.getInitialState(), true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<ToolRail />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const buttons = () => [...container.querySelectorAll<HTMLButtonElement>("button")];
const pressed = () => buttons().filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.dataset.tool);

function key(init: KeyboardEventInit, target: EventTarget = window) {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
  });
}

describe("riel de herramientas", () => {
  it("tiene las siete, con icono, nombre y atajo en la ayuda", () => {
    expect(buttons().map((b) => b.getAttribute("aria-label"))).toEqual([
      "Selección",
      "Texto",
      "Rectángulo",
      "Elipse",
      "Línea",
      "Imagen",
      "Mano",
    ]);
    expect(buttons().every((b) => b.querySelector("svg") !== null)).toBe(true);
    expect(buttons()[2]!.title).toBe("Rectángulo (R)");
    expect(buttons()[2]!.getAttribute("aria-keyshortcuts")).toBe("R");
  });

  it("la activa se ve marcada, y un clic cambia de herramienta", () => {
    expect(pressed()).toEqual(["select"]);
    act(() => buttons()[3]!.click());
    expect(useToolStore.getState().tool).toBe("ellipse");
    expect(pressed()).toEqual(["ellipse"]);
  });

  it("cada tecla activa su herramienta", () => {
    key({ key: "l" });
    expect(pressed()).toEqual(["line"]);
    key({ key: "h" });
    expect(pressed()).toEqual(["hand"]);
    key({ key: "v" });
    expect(pressed()).toEqual(["select"]);
  });

  it("mientras se escribe en un campo, las teclas son texto", () => {
    const input = document.createElement("input");
    container.append(input);
    key({ key: "r" }, input);
    expect(useToolStore.getState().tool).toBe("select");
  });
});
