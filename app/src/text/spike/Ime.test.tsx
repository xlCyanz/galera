import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Ime } from "./Ime";
import { CHECKS } from "./report";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
/** Lo que se ha copiado al portapapeles. */
let copied: string[];

beforeEach(() => {
  copied = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: (text: string) => (copied.push(text), Promise.resolve()) },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<Ime />));
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

const row = (id: string) => container.querySelector<HTMLElement>(`[data-check="${id}"]`)!;
const button = (id: string, label: string) =>
  [...row(id).querySelectorAll("button")].find((one) => one.textContent === label)!;
const click = (element: HTMLElement) => act(() => element.click());
const copy = (label: string) => {
  const found = [...container.querySelectorAll("button")].find((one) => one.textContent === label)!;
  act(() => found.click());
  return copied.at(-1) ?? "";
};

describe("la sesión a mano del spike", () => {
  it("enseña los casos que pide la issue, todos pendientes", () => {
    const rows = [...container.querySelectorAll("[data-check]")];
    expect(rows).toHaveLength(CHECKS.length);
    expect(rows.every((one) => one.getAttribute("data-verdict") === "pendiente")).toBe(true);
  });

  /** El criterio de la tarea: lo que cierra la issue es lo que se anota. */
  it("marcar un caso lo deja anotado, y volver a marcarlo lo quita", async () => {
    await click(button("dictado", "falla"));
    expect(row("dictado").dataset.verdict).toBe("fail");
    expect(button("dictado", "falla").getAttribute("aria-pressed")).toBe("true");

    // Cambiar de opinión: pasa a funcionar.
    await click(button("dictado", "funciona"));
    expect(row("dictado").dataset.verdict).toBe("ok");

    // Y marcar lo mismo dos veces lo desmarca, por si fue sin querer.
    await click(button("dictado", "funciona"));
    expect(row("dictado").dataset.verdict).toBe("pendiente");
  });

  it("el informe sale en Markdown con lo marcado y lo que falta", async () => {
    await click(button("emojis", "funciona"));
    await click(button("pegar", "falla"));

    const report = copy("Copiar el informe");

    expect(report).toContain("# Sesión a mano del spike de entrada (#55)");
    expect(report).toContain("Casos probados: 2 de 8");
    expect(report).toContain("| funciona |");
    expect(report).toContain("| **falla** |");
    expect(report).toContain("## Lo que falló");
    // Y los seis que nadie probó siguen dichos como pendientes.
    expect(report.match(/pendiente/gu)).toHaveLength(6);
  });

  it("el registro en crudo se sigue pudiendo copiar", () => {
    const raw = copy("Copiar el registro");
    expect(raw).toContain("navegador:");
    expect(raw).toContain("modelo:");
  });
});
