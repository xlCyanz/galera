import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { THEME_STORAGE_KEY } from "../theme";
import { ThemeSelect } from "./ThemeSelect";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const select = () => container.querySelector<HTMLSelectElement>("select")!;

describe("el selector del tema", () => {
  /** El criterio de la tarea: claro, oscuro y seguir al sistema. */
  it("ofrece las tres opciones y empieza en la guardada", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    act(() => root.render(<ThemeSelect />));

    expect([...select().options].map((one) => one.value)).toEqual(["system", "light", "dark"]);
    expect(select().value).toBe("light");
  });

  it("elegir uno lo pone en el documento y lo recuerda", () => {
    act(() => root.render(<ThemeSelect />));
    expect(select().value).toBe("system");

    act(() => {
      select().value = "dark";
      select().dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(select().value).toBe("dark");
  });
});
