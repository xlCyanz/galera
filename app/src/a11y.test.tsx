/**
 * Todo control de la interfaz tiene un nombre que se pueda leer en voz alta
 * (F8-03, #90).
 *
 * Un lector de pantalla anuncia cada control por su nombre accesible: el
 * texto de un botón, la etiqueta de un campo, su `aria-label`. Un botón que
 * solo lleva un icono y nada más se anuncia como «botón», sin decir de qué,
 * y con eso no se puede usar la aplicación a ciegas.
 *
 * La prueba monta la aplicación entera con un documento que lleva de todo
 * —texto, formas, imagen, código, grupo, zona de flujo y tabla— y la
 * recorre: cada pestaña de los paneles, el inspector de cada elemento y los
 * diálogos. En cada paso busca todo lo que se puede enfocar o pulsar y
 * comprueba que tenga nombre.
 */
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { App } from "./App";
import type { OpenedProject } from "./commands";
import { useCompilationStore } from "./store/compilation";
import { useDocumentStore } from "./store/document";
import { useLayoutStore } from "./store/layout";
import type { Element } from "./types/model";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const style = { font: "Inter", size: 12, color: "#000000", align: "left" as const, leading: 0.65 };
const run = (text: string) => ({ text, bold: false, italic: false, underline: false });

/** Un elemento de cada tipo, para que salga el inspector de cada uno. */
const elements: Element[] = [
  { type: "text", id: "t1", x: 10, y: 10, w: 60, h: null, rotation: 0, content: [run("Hola {{nombre}}")], style },
  { type: "rect", id: "r1", x: 10, y: 30, w: 20, h: 10, rotation: 0, fill: "#cbd5e1", stroke: null, radius: 0 },
  { type: "ellipse", id: "e1", x: 40, y: 30, w: 20, h: 10, rotation: 0, fill: null, stroke: { color: "#000000", width: 0.5 } },
  { type: "line", id: "l1", x: 10, y: 50, x2: 60, y2: 50, rotation: 0, stroke: { color: "#000000", width: 0.5 } },
  { type: "image", id: "i1", x: 70, y: 10, w: 20, h: null, rotation: 0, asset: "logo" },
  { type: "code", id: "c1", x: 10, y: 60, w: 60, h: 20, rotation: 0, source: "#table(columns: 2)[A][B]" },
  {
    type: "group",
    id: "g1",
    x: 100,
    y: 10,
    w: 20,
    h: 20,
    rotation: 0,
    children: [{ type: "rect", id: "r2", x: 0, y: 0, w: 5, h: 5, rotation: 0, fill: null, stroke: null, radius: 0 }],
  },
  { type: "flow", id: "z1", x: 100, y: 40, w: 40, h: 20, rotation: 0, flow: "cuerpo" },
  {
    type: "table",
    id: "tb1",
    x: 10,
    y: 90,
    w: 100,
    h: null,
    rotation: 0,
    columns: [{ width: "auto" }, { width: "fixed", mm: 20 }],
    rows: [{ cells: [{ content: [run("A")], colspan: 1, rowspan: 1 }, { content: [run("B")], colspan: 1, rowspan: 1 }] }],
    style,
    inset: 2,
  },
] as Element[];

const project: OpenedProject = {
  root: "/p",
  archive: null,
  revision: 1,
  document: {
    version: 1,
    meta: { title: "Todo" },
    fonts: ["fonts/Inter-Regular.ttf"],
    assets: { logo: "assets/logo.png" },
    variables: { nombre: { kind: "text", value: "Ana" } },
    flows: { cuerpo: { content: [run("Fluye")], style, zones: ["z1"] } },
    pages: [
      { id: "p1", size: { width: 210, height: 297, unit: "mm" }, elements },
      { id: "p2", size: { width: 210, height: 297, unit: "mm" }, elements: [] },
    ],
  },
};

/** Lo que se enfoca o se pulsa, y los contenedores que agrupan opciones. */
const INTERACTIVE = [
  "button",
  "a[href]",
  "input:not([type='hidden'])",
  "select",
  "textarea",
  "[tabindex]:not([tabindex='-1'])",
  "[role='button']",
  "[role='checkbox']",
  "[role='switch']",
  "[role='tab']",
  "[role='menuitem']",
  "[role='option']",
  "[role='slider']",
  "[role='listbox']",
  "[role='menu']",
  "[role='toolbar']",
  "[role='tablist']",
  "[role='dialog']",
  "[role='application']",
].join(",");

/** El texto de un elemento tal como lo oiría un lector de pantalla: sin lo
 * que está escondido con `aria-hidden`. */
function spoken(element: Element | globalThis.Element): string {
  const node = element as globalThis.Element;
  if (node.getAttribute?.("aria-hidden") === "true") {
    return "";
  }
  let text = "";
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      text += child.textContent ?? "";
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      text += ` ${spoken(child as globalThis.Element)} `;
    }
  }
  return text.replace(/\s+/gu, " ").trim();
}

/**
 * El nombre accesible, con las reglas que importan aquí de las de ARIA:
 * `aria-labelledby`, `aria-label`, la etiqueta de un campo, el texto del
 * propio control y, al final, su `title`.
 */
export function accessibleName(element: globalThis.Element): string {
  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy !== null) {
    const name = labelledBy
      .split(/\s+/u)
      .map((id) => {
        const target = element.ownerDocument.getElementById(id);
        return target === null ? "" : spoken(target);
      })
      .join(" ")
      .trim();
    if (name !== "") {
      return name;
    }
  }
  const label = element.getAttribute("aria-label")?.trim() ?? "";
  if (label !== "") {
    return label;
  }
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
  ) {
    const labels = [...(element.labels ?? [])].map((one) => spoken(one)).join(" ").trim();
    if (labels !== "") {
      return labels;
    }
    const placeholder = element.getAttribute("placeholder")?.trim() ?? "";
    if (placeholder !== "") {
      return placeholder;
    }
  }
  // Un campo no se nombra con lo que lleva escrito; un botón, sí.
  if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement)) {
    const text = spoken(element);
    if (text !== "") {
      return text;
    }
  }
  return element.getAttribute("title")?.trim() ?? "";
}

/** Los controles sin nombre, con algo que ayude a encontrarlos. */
function nameless(root: HTMLElement): string[] {
  return [...root.querySelectorAll(INTERACTIVE)]
    .filter((element) => element.closest("[aria-hidden='true']") === null)
    .filter((element) => accessibleName(element) === "")
    .map((element) => {
      const tag = element.tagName.toLowerCase();
      const role = element.getAttribute("role");
      const classes = element.getAttribute("class");
      return `<${tag}${role === null ? "" : ` role="${role}"`}${classes === null ? "" : ` class="${classes}"`}>`;
    });
}

let container: HTMLDivElement;
let root: Root;

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(async () => {
  mockIPC(
    (command) => {
      // Las listas que piden los paneles: vacías, que es lo que tiene un
      // proyecto recién abierto sin nada más.
      if (
        command === "templates" ||
        command === "list_assets" ||
        command === "list_fonts" ||
        command === "glyphs" ||
        command === "flow_glyphs" ||
        command === "cell_glyphs" ||
        command === "column_edges"
      ) {
        return [];
      }
      return null;
    },
    { shouldMockEvents: true },
  );
  useDocumentStore.setState(useDocumentStore.getInitialState(), true);
  useLayoutStore.setState(useLayoutStore.getInitialState(), true);
  useCompilationStore.setState(useCompilationStore.getInitialState(), true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<App />));
  await settle();
  act(() => useDocumentStore.getState().open(project));
  await settle();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  clearMocks();
});

const click = async (element: HTMLElement) => {
  await act(async () => {
    element.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

const buttonNamed = (name: string) =>
  [...container.querySelectorAll<HTMLElement>("button")].find((one) => accessibleName(one).startsWith(name));

describe("los nombres accesibles", () => {
  it("el nombre sale de donde tiene que salir", () => {
    const probe = document.createElement("div");
    probe.innerHTML = `
      <button aria-label="Cerrar"><svg aria-hidden="true"></svg></button>
      <button><span aria-hidden="true">×</span>Borrar</button>
      <button><svg aria-hidden="true"></svg></button>
      <label>Ancho <input id="w"></label>
      <input aria-label="Alto">
      <input>`;
    const names = [...probe.querySelectorAll("button, input")].map(accessibleName);
    expect(names).toEqual(["Cerrar", "Borrar", "", "Ancho", "Alto", ""]);
  });

  /** El criterio de la tarea: todos los controles tienen nombre accesible;
   * los iconos sin texto llevan etiqueta. */
  it("la ventana con un documento abierto no tiene controles sin nombre", () => {
    // Que de verdad mire algo: la ventana con un documento lleva decenas.
    expect(container.querySelectorAll(INTERACTIVE).length).toBeGreaterThan(30);
    expect(nameless(container)).toEqual([]);
  });

  it("ninguna pestaña de los paneles tiene controles sin nombre", async () => {
    const tabs = [...container.querySelectorAll<HTMLElement>("[role='tab']")];
    expect(tabs.length).toBeGreaterThan(1);
    for (const tab of tabs) {
      await click(tab);
      expect(nameless(container), accessibleName(tab)).toEqual([]);
    }
  });

  it("el inspector de cada tipo de elemento tampoco", async () => {
    for (const element of elements) {
      act(() => useDocumentStore.getState().select(element.id));
      await settle();
      expect(nameless(container), `${element.type} ${element.id}`).toEqual([]);
    }
    // Y con varios seleccionados, que enseña lo común.
    act(() => useDocumentStore.getState().selectMany(["r1", "e1"]));
    await settle();
    expect(nameless(container), "varios").toEqual([]);
  });

  it("los diálogos y el selector de color tampoco", async () => {
    const help = buttonNamed("Atajos");
    expect(help).toBeDefined();
    await click(help!);
    expect(container.querySelector("[role='dialog']")).not.toBeNull();
    expect(nameless(container), "atajos").toEqual([]);
    await click(buttonNamed("Cerrar")!);

    act(() => useDocumentStore.getState().select("r1"));
    await settle();
    const swatch = container.querySelector<HTMLElement>(".color-swatch");
    expect(swatch).not.toBeNull();
    await click(swatch!);
    expect(container.querySelector(".color-popover")).not.toBeNull();
    expect(nameless(container), "selector de color").toEqual([]);
  });
});
