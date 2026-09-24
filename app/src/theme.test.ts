import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { THEME_STORAGE_KEY, applyTheme, chooseTheme, storedTheme } from "./theme";

beforeEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("el tema de la interfaz", () => {
  it("sin nada elegido, el del sistema", () => {
    expect(storedTheme()).toBe("system");
  });

  /** El criterio de la tarea: la preferencia se recuerda entre sesiones. */
  it("lo elegido se recuerda para la próxima vez", () => {
    chooseTheme("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(storedTheme()).toBe("dark");

    // Volver al del sistema no deja nada guardado.
    chooseTheme("system");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(storedTheme()).toBe("system");
  });

  it("claro y oscuro se ponen en el documento; el del sistema no pone nada", () => {
    applyTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    applyTheme("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    applyTheme("system");
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it("un valor guardado que no es un tema vale como el del sistema", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "morado");
    expect(storedTheme()).toBe("system");
  });

  /** Sin almacenamiento —ventana privada, datos borrados— la interfaz
   * tiene que abrirse igual. */
  it("sin almacenamiento no se rompe nada", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("sin almacenamiento");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("sin almacenamiento");
    });

    expect(storedTheme()).toBe("system");
    expect(() => chooseTheme("dark")).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
