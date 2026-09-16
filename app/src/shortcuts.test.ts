import { describe, expect, it } from "vitest";

import {
  type KeyPress,
  exportPdfShortcutLabel,
  isExportPdfShortcut,
  isMac,
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
