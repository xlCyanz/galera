import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CompilationFailed, OpenedProject } from "../commands";
import { useCompilationStore } from "../store/compilation";
import { useDocumentStore } from "../store/document";
import { StatusBar } from "./StatusBar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const project: OpenedProject = {
  root: "/p",
  archive: null,
  revision: 1,
  document: {
    version: 1,
    meta: { title: "Informe" },
    fonts: [],
    assets: {},
    variables: {},
    pages: [
      { id: "p1", size: { width: 210, height: 297, unit: "mm" }, elements: [] },
      {
        id: "p2",
        size: { width: 210, height: 297, unit: "mm" },
        elements: [
          { type: "code", id: "c1", x: 20, y: 30, w: 100, h: 40, rotation: 0, source: "#table(" },
        ],
      },
    ],
  },
};

const typstFailure: CompilationFailed = {
  revision: 1,
  ms: 4.25,
  reused: false,
  diagnostics: [
    { severity: "error", message: "unclosed delimiter", hints: ["cierra el paréntesis"], element_id: "c1" },
    { severity: "warning", message: "unknown font family: comic", hints: [], element_id: null },
  ],
  error: { kind: "typst", message: "Typst encontró 1 error" },
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  useDocumentStore.setState(useDocumentStore.getInitialState(), true);
  useCompilationStore.setState(useCompilationStore.getInitialState(), true);
  useDocumentStore.getState().open(project);
  container = document.createElement("div");
  root = createRoot(container);
  act(() => root.render(<StatusBar />));
});

afterEach(() => {
  act(() => root.unmount());
});

const text = (selector: string) => container.querySelector(selector)?.textContent;

describe("barra de estado", () => {
  it("enseña el tiempo de la última compilación, la página y el zoom", () => {
    act(() =>
      useCompilationStore
        .getState()
        .finish({ revision: 1, ms: 12.34, reused: false, diagnostics: [], keys: [], pages: ["<svg/>", "<svg/>"], boxes: [], flows: [], cells: [] }),
    );
    expect(text(".status-compilation")).toBe("Compilado en 12,3 ms");
    expect(container.textContent).toContain("Página 1 de 2");
    expect(text(".status-zoom")).toBe("100 %");
    expect(container.querySelector(".issues")).toBeNull();
  });

  it("mientras compila, lo dice", () => {
    act(() => useCompilationStore.getState().start({ revision: 1 }));
    expect(text(".status-compilation")).toBe("Compilando…");
  });

  it("con un error, lo cuenta y abre el panel con el mensaje literal de Typst", () => {
    act(() => useCompilationStore.getState().fail(typstFailure));

    expect(text(".status-compilation")).toBe("No compila (4,3 ms)");
    expect(text(".status-issues")).toBe("1 error y 1 aviso");
    expect(container.querySelector(".status-issues")?.getAttribute("aria-expanded")).toBe("true");

    const messages = [...container.querySelectorAll(".issue-message")].map((node) => node.textContent);
    expect(messages).toEqual(["unclosed delimiter", "unknown font family: comic"]);
    expect(text(".issue-hint")).toBe("Sugerencia: cierra el paréntesis");
  });

  it("los avisos se distinguen de los errores", () => {
    act(() => useCompilationStore.getState().fail(typstFailure));
    const items = [...container.querySelectorAll(".issue")];
    expect(items.map((item) => item.className)).toEqual(["issue is-error", "issue is-warning"]);
    expect(items.map((item) => item.querySelector(".issue-severity")?.textContent)).toEqual([
      "Error",
      "Aviso",
    ]);
  });

  it("el recuento abre y cierra el panel", () => {
    act(() => useCompilationStore.getState().fail(typstFailure));
    const toggle = container.querySelector<HTMLButtonElement>(".status-issues")!;
    act(() => toggle.click());
    expect(container.querySelector(".issues")).toBeNull();
    act(() => toggle.click());
    expect(container.querySelector(".issues")).not.toBeNull();
  });

  it("solo con avisos, el panel no se abre solo", () => {
    act(() =>
      useCompilationStore.getState().finish({
        revision: 1,
        ms: 5,
        reused: false,
        diagnostics: [typstFailure.diagnostics[1]!],
        keys: [],
        pages: ["<svg/>", "<svg/>"],
        boxes: [],
        flows: [], cells: [],
      }),
    );
    expect(text(".status-issues")).toBe("1 aviso");
    expect(container.querySelector(".issues")).toBeNull();
  });

  it("el enlace del elemento lleva a su página y lo resalta", () => {
    act(() => useCompilationStore.getState().fail(typstFailure));
    const link = container.querySelector<HTMLButtonElement>(".issue-element")!;
    expect(link.textContent).toBe("Ir a «c1»");
    // Solo el error trae elemento.
    expect(container.querySelectorAll(".issue-element")).toHaveLength(1);

    const before = useDocumentStore.getState().focusRequests;
    act(() => link.click());
    expect(useDocumentStore.getState()).toMatchObject({
      currentPage: 1,
      highlightedElement: "c1",
      focusRequests: before + 1,
    });
  });

  it("un error de validación enlaza a cada elemento con problema", () => {
    act(() =>
      useCompilationStore.getState().fail({
        revision: 1,
        ms: 1,
        reused: false,
        diagnostics: [],
        error: {
          kind: "invalid",
          message: "el documento tiene 1 problema",
          problems: [{ location: { kind: "element", id: "c1" }, message: "w tiene que ser mayor que cero, y es -3" }],
        },
      }),
    );
    expect(text(".issue-message")).toBe("w tiene que ser mayor que cero, y es -3");
    expect(text(".issue-element")).toBe("Ir a «c1»");
  });
});

describe("lo que se anuncia de la compilación", () => {
  const spoken = () => container.querySelector('.status-bar [role="status"]')?.textContent ?? null;
  const ready = () =>
    useCompilationStore
      .getState()
      .finish({ revision: 1, ms: 5, reused: false, diagnostics: [], keys: [], pages: ["<svg/>"], boxes: [], flows: [], cells: [] });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** El criterio de la tarea: los cambios de estado se anuncian. La región
   * está siempre, para que el lector de pantalla oiga cuando cambia. */
  it("la región que se oye está siempre, aunque no diga nada", () => {
    expect(spoken()).toBe("");
  });

  it("un error se dice, y también cuando se va", () => {
    act(() => useCompilationStore.getState().fail(typstFailure));
    expect(spoken()).toMatch(/^No compila/u);

    act(() => useCompilationStore.getState().start({ revision: 2 }));
    act(ready);
    expect(spoken()).toBe("Vuelve a compilar sin errores");
  });

  /** Se compila en cada tecla: eso no se anuncia, que si no, no pararía. */
  it("una compilación rápida no se anuncia", () => {
    vi.useFakeTimers();
    act(ready);
    act(() => useCompilationStore.getState().start({ revision: 2 }));
    act(() => vi.advanceTimersByTime(200));
    act(ready);
    act(() => vi.advanceTimersByTime(2000));
    expect(spoken()).toBe("");
  });

  it("una lenta sí: que se está compilando y que acabó", () => {
    vi.useFakeTimers();
    act(ready);
    act(() => useCompilationStore.getState().start({ revision: 2 }));
    act(() => vi.advanceTimersByTime(1500));
    expect(spoken()).toBe("Compilando…");

    act(ready);
    expect(spoken()).toBe("Compilado");
  });
});
