import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { pretendMac, useShortcut } from "./useShortcuts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let done: string[];

function Saver({ enabled = true }: { enabled?: boolean }) {
  useShortcut("save", () => {
    done.push("guardar");
  }, enabled);
  return null;
}

function Both() {
  useShortcut("save", () => {
    done.push("primero");
  });
  useShortcut("toolRect", () => {
    done.push("rectángulo");
  });
  return null;
}

beforeEach(() => {
  pretendMac(true);
  done = [];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function press(init: KeyboardEventInit, target: EventTarget = window) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

describe("useShortcut", () => {
  it("atiende su atajo y no los demás, y evita que la tecla haga otra cosa", () => {
    act(() => root.render(<Saver />));
    const event = press({ key: "s", metaKey: true });
    expect(done).toEqual(["guardar"]);
    expect(event.defaultPrevented).toBe(true);

    press({ key: "e", metaKey: true, shiftKey: true });
    expect(done).toEqual(["guardar"]);
  });

  it("deja de atenderlo al desmontarse o al desactivarlo", () => {
    act(() => root.render(<Saver enabled={false} />));
    press({ key: "s", metaKey: true });
    expect(done).toEqual([]);

    act(() => root.render(<Saver />));
    press({ key: "s", metaKey: true });
    expect(done).toEqual(["guardar"]);

    act(() => root.render(<></>));
    press({ key: "s", metaKey: true });
    expect(done).toEqual(["guardar"]);
  });

  it("mientras se escribe, solo pasan los de ⌘, y no deshacer", () => {
    act(() => root.render(<Both />));
    const input = document.createElement("input");
    container.append(input);

    press({ key: "r" }, input);
    expect(done).toEqual([]);

    press({ key: "s", metaKey: true }, input);
    expect(done).toEqual(["primero"]);
  });

  it("usa el modificador del sistema", () => {
    act(() => root.render(<Saver />));
    press({ key: "s", ctrlKey: true });
    expect(done).toEqual([]);

    pretendMac(false);
    press({ key: "s", ctrlKey: true });
    expect(done).toEqual(["guardar"]);
    press({ key: "s", metaKey: true });
    expect(done).toEqual(["guardar"]);
  });

  it("una tecla repetida no repite el atajo, pero una flecha sí", () => {
    function Arrows() {
      useShortcut("toolRect", () => {
    done.push("rectángulo");
  });
      useShortcut("nudgeLeft", () => {
    done.push("izquierda");
  });
      return null;
    }
    act(() => root.render(<Arrows />));
    press({ key: "r", repeat: true });
    expect(done).toEqual([]);
    press({ key: "ArrowLeft", repeat: true });
    expect(done).toEqual(["izquierda"]);
  });
});
