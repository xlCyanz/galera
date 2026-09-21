import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AppliedOp, OpenedProject, VariableStatus } from "../commands";
import { useDocumentStore } from "../store/document";
import { VariablesPanel } from "./VariablesPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const project: OpenedProject = {
  root: "/p",
  revision: 1,
  archive: null,
  document: {
    version: 1,
    meta: { title: "x" },
    fonts: [],
    assets: {},
    variables: { nombre: { kind: "text", value: "Cooperativa Agrícola del Este" } },
    pages: [{ id: "p1", size: { width: 210, height: 297, unit: "mm" }, elements: [] }],
  },
};

let container: HTMLDivElement;
let root: Root;
let ops: Array<Record<string, unknown>>;
/** Si el backend rechaza el cambio, con este mensaje. */
let refuse: string | null;
/** Lo que el núcleo dice de cada variable. */
let status: Record<string, VariableStatus>;

beforeEach(() => {
  ops = [];
  refuse = null;
  status = {};
  mockIPC((command, args) => {
    if (command === "variable_status") {
      const name = (args as { name: string }).name;
      return status[name] ?? { usedBy: [], invalid: null };
    }
    if (command === "apply_op") {
      const op = (args as { op: Record<string, string> }).op;
      ops.push(op);
      if (refuse !== null) {
        throw { kind: "op", message: refuse };
      }
      // Aplica el cambio como el núcleo, para ver la lista nueva.
      const document = structuredClone(useDocumentStore.getState().document!);
      if (op.op === "set_variable") {
        document.variables[op.name!] = (op as unknown as { variable: { kind: "text"; value: string } }).variable;
      } else if (op.op === "remove_variable") {
        delete document.variables[op.name!];
      } else if (op.op === "rename_variable") {
        document.variables[op.to!] = document.variables[op.from!]!;
        delete document.variables[op.from!];
      }
      const applied: AppliedOp = { revision: 2, document, description: "x", undo: "x", redo: null };
      return applied;
    }
    return null;
  });
  useDocumentStore.setState(useDocumentStore.getInitialState(), true);
  useDocumentStore.getState().open(project);
  container = window.document.createElement("div");
  window.document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<VariablesPanel />));
});

/** Deja llegar lo que el núcleo dice de cada variable. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Monta el panel otra vez, para que vuelva a preguntar por las variables. */
async function remount() {
  act(() => root.unmount());
  container.remove();
  container = window.document.createElement("div");
  window.document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<VariablesPanel />);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  clearMocks();
});

const row = (name: string) => container.querySelector<HTMLElement>(`[data-variable="${name}"]`);
const input = (label: string) => container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;

function type(field: HTMLInputElement, text: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function key(field: HTMLInputElement, name: string) {
  await act(async () => {
    field.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function blur(field: HTMLInputElement) {
  await act(async () => {
    field.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("panel de variables", () => {
  it("lista las del documento con su valor", () => {
    expect(row("nombre")).not.toBeNull();
    expect(input("Valor de nombre").value).toBe("Cooperativa Agrícola del Este");
  });

  it("cambiar el valor manda un comando al salir del campo", async () => {
    const value = input("Valor de nombre");
    type(value, "Otra cooperativa");
    await blur(value);
    expect(ops).toEqual([
      { op: "set_variable", name: "nombre", variable: { kind: "text", value: "Otra cooperativa" } },
    ]);
    expect(useDocumentStore.getState().document?.variables.nombre?.value).toBe("Otra cooperativa");
    expect(useDocumentStore.getState().history.undo).toBe("x");
  });

  it("añadir crea una variable vacía con ese nombre", async () => {
    await act(async () => {
      [...container.querySelectorAll("button")].find((b) => b.textContent === "Añadir…")!.click();
    });
    const name = input("Nombre de la variable nueva");
    type(name, "anio");
    await key(name, "Enter");
    expect(ops).toEqual([
      { op: "set_variable", name: "anio", variable: { kind: "text", value: "" } },
    ]);
    expect(row("anio")).not.toBeNull();
  });

  it("doble clic en el nombre lo renombra; Esc cancela", async () => {
    const rename = async (from: string, to: string, last: string) => {
      act(() => {
        row(from)!.querySelector(".variable-name")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      });
      const field = input(`Nombre de ${from}`);
      type(field, to);
      await key(field, last);
    };

    await rename("nombre", "empresa", "Escape");
    expect(ops).toHaveLength(0);

    await rename("nombre", "empresa", "Enter");
    expect(ops).toEqual([{ op: "rename_variable", from: "nombre", to: "empresa" }]);
    expect(row("empresa")).not.toBeNull();
    expect(row("nombre")).toBeNull();
  });

  it("quitar una la borra del documento", async () => {
    await act(async () => {
      row("nombre")!.querySelector<HTMLButtonElement>(".asset-remove")!.click();
    });
    expect(ops).toEqual([{ op: "remove_variable", name: "nombre" }]);
    expect(container.textContent).toContain("no tiene variables");
  });

  it("un nombre que el núcleo rechaza se dice y no cambia nada", async () => {
    refuse = 'el nombre de variable "con espacio" no vale: solo puede tener letras y dígitos ASCII, guion y guion bajo';
    await act(async () => {
      [...container.querySelectorAll("button")].find((b) => b.textContent === "Añadir…")!.click();
    });
    const name = input("Nombre de la variable nueva");
    type(name, "con espacio");
    await key(name, "Enter");
    expect(container.textContent).toContain("no vale");
    expect(Object.keys(useDocumentStore.getState().document!.variables)).toEqual(["nombre"]);
  });

  /** El criterio de la tarea: el tipo se elige y se manda con el valor. */
  it("cambiar el tipo manda la variable entera", async () => {
    const kind = container.querySelector<HTMLSelectElement>('select[aria-label="Tipo de nombre"]')!;
    expect([...kind.options].map((one) => one.value)).toEqual(["text", "number", "date", "image"]);

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
      setter.call(kind, "date");
      kind.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(ops).toEqual([
      {
        op: "set_variable",
        name: "nombre",
        variable: { kind: "date", value: "Cooperativa Agrícola del Este" },
      },
    ]);
  });

  /** El criterio de la tarea: se ve dónde se usa cada variable. */
  it("dice en qué elementos se usa, y lo que el núcleo objeta del valor", async () => {
    status = { nombre: { usedBy: ["t1", "c1"], invalid: "no es una fecha" } };
    await remount();

    expect(row("nombre")?.textContent).toContain("Se usa en 2 elementos: t1, c1");
    expect(row("nombre")?.textContent).toContain("no es una fecha");
  });

  it("sin usarse en ningún sitio lo dice también", async () => {
    await settle();
    expect(row("nombre")?.textContent).toContain("Sin usar");
  });

  /** El criterio de la tarea: quitar una que se usa avisa antes. */
  it("quitar una que se usa pregunta, y solo la quita si se confirma", async () => {
    status = { nombre: { usedBy: ["t1"], invalid: null } };
    await remount();

    await act(async () => {
      row("nombre")!.querySelector<HTMLButtonElement>(".asset-remove")!.click();
    });
    expect(ops).toHaveLength(0);
    expect(container.textContent).toContain("se usa en 1 elemento");

    // Dejarla: no se manda nada.
    await act(async () => {
      [...container.querySelectorAll("button")].find((one) => one.textContent === "Dejarla")!.click();
    });
    expect(ops).toHaveLength(0);
    expect(row("nombre")).not.toBeNull();

    // Y confirmando sí.
    await act(async () => {
      row("nombre")!.querySelector<HTMLButtonElement>(".asset-remove")!.click();
    });
    await act(async () => {
      [...container.querySelectorAll("button")]
        .find((one) => one.textContent === "Quitarla igualmente")!
        .click();
    });
    expect(ops).toEqual([{ op: "remove_variable", name: "nombre" }]);
  });
});
