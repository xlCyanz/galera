import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { OpenedProject } from "../commands";
import { useDocumentStore } from "../store/document";
import { useEditingStore } from "../store/editing";
import type { LayoutBox } from "../types/layout";
import { ChipPicker } from "./ChipPicker";

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
    variables: {
      empresa: { kind: "text", value: "Cooperativa" },
      fecha: { kind: "date", value: "2026-09-21" },
      total: { kind: "number", value: "" },
    },
    pages: [{ id: "p1", size: { width: 200, height: 100, unit: "mm" }, elements: [] }],
  },
};

const box: LayoutBox = {
  id: "t1",
  page: 0,
  x: 10,
  y: 10,
  w: 80,
  h: 20,
  rotation: 0,
  bounds: { x: 10, y: 10, w: 80, h: 20 },
  line: null,
  overflow: 0,
};

const transform = { origin: { x: 0, y: 0 }, pxPerMm: 2 };

let container: HTMLDivElement;
let root: Root;

/** Monta la lista con ese texto y el cursor en ese byte. */
function show(text: string, at: number) {
  act(() => {
    useEditingStore.getState().edit("t1", at);
    useEditingStore.getState().select(at, at);
  });
  act(() => root.render(<ChipPicker text={text} box={box} transform={transform} />));
}

beforeEach(() => {
  useDocumentStore.setState(useDocumentStore.getInitialState(), true);
  useEditingStore.setState(useEditingStore.getInitialState(), true);
  useDocumentStore.getState().open(project);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const options = () => [...container.querySelectorAll<HTMLButtonElement>('[role="option"]')];
const names = () => options().map((one) => one.textContent?.replace(/(sin valor|Cooperativa|2026-09-21)$/, ""));

function press(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

describe("la lista de variables al escribir", () => {
  /** El criterio de la tarea: la ficha se inserta escribiendo `{{`. */
  it("sale al abrir `{{` y enseña las variables", () => {
    show("Hola {{", 7);
    expect(names()).toEqual(["empresa", "fecha", "total"]);
  });

  it("se filtra con lo que se lleve escrito", () => {
    show("Hola {{f", 8);
    expect(names()).toEqual(["fecha"]);
  });

  it("sin nada que encaje no sale", () => {
    show("Hola {{zzz", 10);
    expect(container.querySelector(".chip-picker")).toBeNull();
  });

  it("sin `{{` delante tampoco", () => {
    show("Hola", 4);
    expect(container.querySelector(".chip-picker")).toBeNull();
  });

  it("elegir con el ratón pide poner la ficha en lugar de lo tecleado", () => {
    show("Hola {{f", 8);
    act(() => options()[0]?.click());

    const { insert, insertRequests } = useEditingStore.getState();
    expect(insertRequests).toBe(1);
    expect(insert).toEqual({ text: "{{fecha}}", from: 5, to: 8 });
  });

  it("las flechas mueven por la lista y Enter pone la que esté marcada", () => {
    show("Hola {{", 7);
    press("ArrowDown");
    expect(options()[1]?.getAttribute("aria-selected")).toBe("true");

    press("Enter");
    expect(useEditingStore.getState().insert).toEqual({
      text: "{{fecha}}",
      from: 5,
      to: 7,
    });
  });

  it("enseña el valor de cada una, y dice cuál no tiene", () => {
    show("Hola {{", 7);
    expect(options()[0]?.textContent).toContain("Cooperativa");
    expect(options()[2]?.textContent).toContain("sin valor");
  });
});
