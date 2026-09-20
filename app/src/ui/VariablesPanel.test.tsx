import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AppliedOp, OpenedProject } from "../commands";
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
    variables: { nombre: "Cooperativa Agrícola del Este" },
    pages: [{ id: "p1", size: { width: 210, height: 297, unit: "mm" }, elements: [] }],
  },
};

let container: HTMLDivElement;
let root: Root;
let ops: Array<Record<string, unknown>>;
/** Si el backend rechaza el cambio, con este mensaje. */
let refuse: string | null;

beforeEach(() => {
  ops = [];
  refuse = null;
  mockIPC((command, args) => {
    if (command === "apply_op") {
      const op = (args as { op: Record<string, string> }).op;
      ops.push(op);
      if (refuse !== null) {
        throw { kind: "op", message: refuse };
      }
      // Aplica el cambio como el núcleo, para ver la lista nueva.
      const document = structuredClone(useDocumentStore.getState().document!);
      if (op.op === "set_variable") {
        document.variables[op.name!] = op.value!;
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
    expect(ops).toEqual([{ op: "set_variable", name: "nombre", value: "Otra cooperativa" }]);
    expect(useDocumentStore.getState().document?.variables.nombre).toBe("Otra cooperativa");
    expect(useDocumentStore.getState().history.undo).toBe("x");
  });

  it("añadir crea una variable vacía con ese nombre", async () => {
    await act(async () => {
      [...container.querySelectorAll("button")].find((b) => b.textContent === "Añadir…")!.click();
    });
    const name = input("Nombre de la variable nueva");
    type(name, "anio");
    await key(name, "Enter");
    expect(ops).toEqual([{ op: "set_variable", name: "anio", value: "" }]);
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
});
