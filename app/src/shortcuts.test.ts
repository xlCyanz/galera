import { describe, expect, it } from "vitest";

import {
  type KeyPress,
  exportPdfShortcutLabel,
  historyShortcut,
  historyShortcutLabel,
  isExportPdfShortcut,
  isMac,
  isSaveShortcut,
  isToggleRulersShortcut,
  zoomShortcut,
  zoomShortcutLabel,
} from "./shortcuts";

function press(overrides: Partial<KeyPress>): KeyPress {
  return { key: "E", metaKey: false, ctrlKey: false, shiftKey: true, altKey: false, ...overrides };
}

describe("isExportPdfShortcut", () => {
  it("en macOS es ⌘⇧E", () => {
    expect(isExportPdfShortcut(press({ metaKey: true }), true)).toBe(true);
    expect(isExportPdfShortcut(press({ metaKey: true, key: "e" }), true)).toBe(true);
    expect(isExportPdfShortcut(press({ ctrlKey: true }), true)).toBe(false);
  });

  it("en Windows y Linux es Ctrl+Shift+E", () => {
    expect(isExportPdfShortcut(press({ ctrlKey: true }), false)).toBe(true);
    expect(isExportPdfShortcut(press({ metaKey: true }), false)).toBe(false);
  });

  it("no se dispara sin Shift, con Alt, con otra tecla o con los dos modificadores", () => {
    expect(isExportPdfShortcut(press({ metaKey: true, shiftKey: false }), true)).toBe(false);
    expect(isExportPdfShortcut(press({ metaKey: true, altKey: true }), true)).toBe(false);
    expect(isExportPdfShortcut(press({ metaKey: true, key: "S" }), true)).toBe(false);
    expect(isExportPdfShortcut(press({ metaKey: true, ctrlKey: true }), true)).toBe(false);
  });
});

describe("isMac", () => {
  it("reconoce macOS por el agente de usuario", () => {
    expect(isMac("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15")).toBe(
      true,
    );
    expect(isMac("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")).toBe(false);
    expect(isMac("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36")).toBe(false);
  });
});

describe("exportPdfShortcutLabel", () => {
  it("se escribe como en cada sistema", () => {
    expect(exportPdfShortcutLabel(true)).toBe("⌘⇧E");
    expect(exportPdfShortcutLabel(false)).toBe("Ctrl+Shift+E");
  });
});

describe("zoomShortcut", () => {
  const key = (value: string, overrides: Partial<KeyPress> = {}) =>
    press({ key: value, shiftKey: false, metaKey: true, ...overrides });

  it("⌘+ y ⌘= acercan, ⌘- aleja, ⌘0 es 100 % y ⌘1 ajusta", () => {
    expect(zoomShortcut(key("+", { shiftKey: true }), true)).toBe("in");
    expect(zoomShortcut(key("="), true)).toBe("in");
    expect(zoomShortcut(key("-"), true)).toBe("out");
    expect(zoomShortcut(key("0"), true)).toBe("reset");
    expect(zoomShortcut(key("1"), true)).toBe("fit");
  });

  it("en Windows y Linux van con Ctrl", () => {
    expect(zoomShortcut(key("0", { metaKey: false, ctrlKey: true }), false)).toBe("reset");
    expect(zoomShortcut(key("0"), false)).toBeNull();
  });

  it("sin modificador, con Alt o con otra tecla no son atajos", () => {
    expect(zoomShortcut(key("0", { metaKey: false }), true)).toBeNull();
    expect(zoomShortcut(key("0", { altKey: true }), true)).toBeNull();
    expect(zoomShortcut(key("2"), true)).toBeNull();
  });

  it("se escriben como en cada sistema", () => {
    expect(zoomShortcutLabel("fit", true)).toBe("⌘1");
    expect(zoomShortcutLabel("in", false)).toBe("Ctrl++");
  });
});

describe("isToggleRulersShortcut", () => {
  it("es ⇧R, en cualquier sistema", () => {
    expect(isToggleRulersShortcut(press({ key: "R" }))).toBe(true);
    expect(isToggleRulersShortcut(press({ key: "r" }))).toBe(true);
  });

  it("sin Shift o con otro modificador no lo es", () => {
    expect(isToggleRulersShortcut(press({ key: "r", shiftKey: false }))).toBe(false);
    expect(isToggleRulersShortcut(press({ key: "R", metaKey: true }))).toBe(false);
    expect(isToggleRulersShortcut(press({ key: "R", ctrlKey: true }))).toBe(false);
    expect(isToggleRulersShortcut(press({ key: "R", altKey: true }))).toBe(false);
    expect(isToggleRulersShortcut(press({ key: "E" }))).toBe(false);
  });
});

describe("historyShortcut", () => {
  const key = (k: string, overrides: Partial<KeyPress> = {}) => press({ key: k, shiftKey: false, ...overrides });

  it("en macOS, ⌘Z deshace y ⌘⇧Z rehace", () => {
    expect(historyShortcut(key("z", { metaKey: true }), true)).toBe("undo");
    // Con Shift, el navegador da la mayúscula.
    expect(historyShortcut(key("Z", { metaKey: true, shiftKey: true }), true)).toBe("redo");
    expect(historyShortcut(key("z", { ctrlKey: true }), true)).toBeNull();
    expect(historyShortcut(key("y", { metaKey: true }), true)).toBeNull();
  });

  it("en Windows y Linux, Ctrl+Z deshace y Ctrl+Shift+Z o Ctrl+Y rehacen", () => {
    expect(historyShortcut(key("z", { ctrlKey: true }), false)).toBe("undo");
    expect(historyShortcut(key("Z", { ctrlKey: true, shiftKey: true }), false)).toBe("redo");
    expect(historyShortcut(key("y", { ctrlKey: true }), false)).toBe("redo");
    expect(historyShortcut(key("z", { metaKey: true }), false)).toBeNull();
  });

  it("no se dispara sin modificador, con Alt o con otra tecla", () => {
    expect(historyShortcut(key("z"), true)).toBeNull();
    expect(historyShortcut(key("z", { metaKey: true, altKey: true }), true)).toBeNull();
    expect(historyShortcut(key("x", { metaKey: true }), true)).toBeNull();
  });

  it("se enseña con el modificador de cada sistema", () => {
    expect(historyShortcutLabel("undo", true)).toBe("⌘Z");
    expect(historyShortcutLabel("redo", true)).toBe("⌘⇧Z");
    expect(historyShortcutLabel("undo", false)).toBe("Ctrl+Z");
    expect(historyShortcutLabel("redo", false)).toBe("Ctrl+Shift+Z");
  });
});

describe("isSaveShortcut", () => {
  const key = (overrides: Partial<KeyPress> = {}) => press({ key: "s", shiftKey: false, ...overrides });

  it("es ⌘S en macOS y Ctrl+S en el resto", () => {
    expect(isSaveShortcut(key({ metaKey: true }), true)).toBe(true);
    expect(isSaveShortcut(key({ key: "S", metaKey: true }), true)).toBe(true);
    expect(isSaveShortcut(key({ ctrlKey: true }), false)).toBe(true);
    expect(isSaveShortcut(key({ ctrlKey: true }), true)).toBe(false);
  });

  it("no se dispara sin modificador, con Shift o con Alt", () => {
    expect(isSaveShortcut(key(), true)).toBe(false);
    expect(isSaveShortcut(key({ metaKey: true, shiftKey: true }), true)).toBe(false);
    expect(isSaveShortcut(key({ metaKey: true, altKey: true }), true)).toBe(false);
  });
});
