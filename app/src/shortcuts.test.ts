import { describe, expect, it } from "vitest";

// Vite trae el archivo tal cual: así la documentación se comprueba contra el
// registro, sin copiar la lista a ningún sitio.
import docs from "../../docs/atajos.md?raw";

import {
  GROUPS,
  type KeyPress,
  type Shortcut,
  SHORTCUTS,
  isMac,
  isTypingTarget,
  shortcut,
  shortcutFor,
  shortcutLabel,
  worksWhileTyping,
} from "./shortcuts";

const press = (key: string, overrides: Partial<KeyPress> = {}): KeyPress => ({
  key,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...overrides,
});

describe("el registro", () => {
  it("no repite ids y todos tienen nombre y grupo conocido", () => {
    const ids = SHORTCUTS.map((one) => one.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const one of SHORTCUTS) {
      expect(one.label.length).toBeGreaterThan(0);
      expect(GROUPS).toContain(one.group);
    }
  });

  it("no hay dos atajos con las mismas teclas", () => {
    const seen = new Map<string, string>();
    for (const one of SHORTCUTS as ReadonlyArray<Shortcut>) {
      const keys = Array.isArray(one.keys.key) ? one.keys.key : [one.keys.key];
      for (const key of keys) {
        const combo = [one.keys.mod === true, one.keys.shift === true, one.keys.alt === true, key].join("|");
        expect(seen.get(combo), `${one.id} y ${seen.get(combo)} comparten teclas`).toBeUndefined();
        seen.set(combo, one.id);
      }
    }
  });
});

describe("shortcutFor", () => {
  it("reconoce los atajos con modificador, según el sistema", () => {
    expect(shortcutFor(press("s", { metaKey: true }), true)).toBe("save");
    expect(shortcutFor(press("s", { ctrlKey: true }), false)).toBe("save");
    expect(shortcutFor(press("s", { ctrlKey: true }), true)).toBeNull();
    expect(shortcutFor(press("S", { metaKey: true, shiftKey: true }), true)).toBe("saveAs");
    expect(shortcutFor(press("e", { metaKey: true, shiftKey: true }), true)).toBe("exportPdf");
    expect(shortcutFor(press("z", { metaKey: true }), true)).toBe("undo");
    expect(shortcutFor(press("z", { metaKey: true, shiftKey: true }), true)).toBe("redo");
  });

  it("Ctrl+Y también rehace fuera de macOS", () => {
    expect(shortcutFor(press("y", { ctrlKey: true }), false)).toBe("redo");
    expect(shortcutFor(press("y", { metaKey: true }), true)).toBeNull();
  });

  it("las teclas sueltas son herramientas, reglas o flechas", () => {
    expect(shortcutFor(press("v"), true)).toBe("toolSelect");
    expect(shortcutFor(press("R", { shiftKey: true }), true)).toBe("toggleRulers");
    expect(shortcutFor(press("r"), true)).toBe("toolRect");
    expect(shortcutFor(press("ArrowLeft"), true)).toBe("nudgeLeft");
    // Con Shift es el mismo atajo: mueve 10 mm en vez de 1.
    expect(shortcutFor(press("ArrowLeft", { shiftKey: true }), true)).toBe("nudgeLeft");
    expect(shortcutFor(press("Escape"), true)).toBe("deselect");
    expect(shortcutFor(press("q"), true)).toBeNull();
  });

  it("el zoom acepta las dos teclas de cada signo", () => {
    expect(shortcutFor(press("+", { metaKey: true }), true)).toBe("zoomIn");
    expect(shortcutFor(press("=", { metaKey: true }), true)).toBe("zoomIn");
    expect(shortcutFor(press("-", { metaKey: true }), true)).toBe("zoomOut");
    expect(shortcutFor(press("0", { metaKey: true }), true)).toBe("zoomReset");
    expect(shortcutFor(press("1", { metaKey: true }), true)).toBe("zoomFit");
  });
});

describe("shortcutLabel", () => {
  it("usa los símbolos de macOS y el texto del resto", () => {
    expect(shortcutLabel("exportPdf", true)).toBe("⌘⇧E");
    expect(shortcutLabel("exportPdf", false)).toBe("Ctrl+Shift+E");
    expect(shortcutLabel("save", true)).toBe("⌘S");
    expect(shortcutLabel("toolRect", true)).toBe("R");
    expect(shortcutLabel("toggleRulers", true)).toBe("⇧R");
    expect(shortcutLabel("deselect", true)).toBe("Esc");
    expect(shortcutLabel("nudgeLeft", true)).toBe("←");
    expect(shortcutLabel("zoomIn", true)).toBe("⌘+");
    expect(shortcutLabel("zoomOut", false)).toBe("Ctrl+−");
  });
});

describe("mientras se escribe", () => {
  it("un campo de texto es un sitio donde se escribe", () => {
    const input = document.createElement("input");
    expect(isTypingTarget(input)).toBe(true);
    expect(isTypingTarget(document.createElement("div"))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });

  it("ahí solo valen los de ⌘, y ni deshacer ni rehacer", () => {
    expect(worksWhileTyping("save")).toBe(true);
    expect(worksWhileTyping("exportPdf")).toBe(true);
    expect(worksWhileTyping("toolRect")).toBe(false);
    expect(worksWhileTyping("deselect")).toBe(false);
    expect(worksWhileTyping("nudgeLeft")).toBe(false);
    expect(worksWhileTyping("undo")).toBe(false);
    expect(worksWhileTyping("redo")).toBe(false);
  });
});

describe("isMac", () => {
  it("mira el sistema del webview", () => {
    expect(isMac("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe(true);
    expect(isMac("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe(false);
  });
});

describe("shortcut", () => {
  it("devuelve el atajo por su id", () => {
    expect(shortcut("save").label).toBe("Guardar");
    expect(shortcut("toolHand").group).toBe("Herramientas");
  });
});

describe("docs/atajos.md", () => {

  it("tiene todos los atajos del registro, con sus teclas en los dos sistemas", () => {
    for (const one of SHORTCUTS as ReadonlyArray<Shortcut>) {
      const row = `| ${one.label} | \`${shortcutLabel(one.id, true)}\` | \`${shortcutLabel(one.id, false)}\` |`;
      expect(docs, `falta en docs/atajos.md: ${one.id}`).toContain(row);
    }
    for (const group of GROUPS) {
      expect(docs).toContain(`### ${group}`);
    }
  });

  it("no documenta atajos que ya no existen", () => {
    const documented = [...docs.matchAll(/^\| (?!Qué hace)(.+?) \| `/gm)].map((match) => match[1]);
    const labels = new Set((SHORTCUTS as ReadonlyArray<Shortcut>).map((one) => one.label));
    for (const label of documented) {
      expect(labels, `sobra en docs/atajos.md: ${label}`).toContain(label);
    }
    expect(documented).toHaveLength(SHORTCUTS.length);
  });
});
