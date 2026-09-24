import { act, useRef, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useDialogFocus } from "./useDialogFocus";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Un botón que abre un diálogo con dos botones, como los de la app. */
function Harness({ trap = true }: { trap?: boolean }) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  useDialogFocus(dialog, { active: open, onEscape: () => setOpen(false), trap });
  return (
    <>
      <button type="button" data-testid="opener" onClick={() => setOpen(true)}>
        Abrir
      </button>
      <button type="button" data-testid="after">
        Después
      </button>
      {open && (
        <div ref={dialog} tabIndex={-1} role="dialog" aria-label="Prueba">
          <button type="button" data-testid="first">
            Uno
          </button>
          <button type="button" data-testid="last">
            Dos
          </button>
        </div>
      )}
    </>
  );
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const get = (id: string) => container.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const press = (key: string, shiftKey = false) =>
  act(() => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true }),
    );
  });

function open() {
  act(() => root.render(<Harness />));
  get("opener")!.focus();
  act(() => get("opener")!.click());
}

describe("el foco de un diálogo", () => {
  /** El criterio de la tarea: los diálogos atrapan el foco. */
  it("entra en el diálogo al abrirlo", () => {
    open();
    expect(document.activeElement).toBe(get("first"));
  });

  it("el tabulador da la vuelta dentro, en los dos sentidos", () => {
    open();
    get("last")!.focus();
    press("Tab");
    expect(document.activeElement).toBe(get("first"));

    press("Tab", true);
    expect(document.activeElement).toBe(get("last"));
  });

  it("si el foco se escapa, el tabulador lo devuelve dentro", () => {
    open();
    get("after")!.focus();
    press("Tab");
    expect(document.activeElement).toBe(get("first"));
  });

  /** El criterio de la tarea: se cierran con Esc, devolviendo el foco a
   * donde estaba. */
  it("Esc lo cierra y el foco vuelve a lo que lo abrió", () => {
    open();
    press("Escape");

    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(get("opener"));
  });

  it("Esc no llega a los atajos de fuera", () => {
    open();
    let reached = false;
    const listener = () => {
      reached = true;
    };
    window.addEventListener("keydown", listener);
    press("Escape");
    window.removeEventListener("keydown", listener);

    expect(reached).toBe(false);
  });

  it("sin trampa, el tabulador sigue su camino", () => {
    act(() => root.render(<Harness trap={false} />));
    act(() => get("opener")!.click());
    get("last")!.focus();

    const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    act(() => {
      get("last")!.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false);
  });
});
