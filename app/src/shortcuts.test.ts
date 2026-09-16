import { describe, expect, it } from "vitest";

import { type KeyPress, exportPdfShortcutLabel, isExportPdfShortcut, isMac } from "./shortcuts";

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
