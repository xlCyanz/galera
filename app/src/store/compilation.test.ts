import { beforeEach, describe, expect, it } from "vitest";

import type { CompilationFailed, CompilationFinished } from "../commands";
import type { Diagnostic } from "../types/diagnostic";
import { useCompilationStore } from "./compilation";

function finished(overrides: Partial<CompilationFinished> = {}): CompilationFinished {
  return { revision: 1, ms: 12, reused: false, diagnostics: [], pages: ["<svg>1</svg>"], boxes: [], ...overrides };
}

const typstError: Diagnostic = {
  severity: "error",
  message: "unclosed delimiter",
  hints: [],
  element_id: "c1",
};

function failed(overrides: Partial<CompilationFailed> = {}): CompilationFailed {
  return {
    revision: 1,
    ms: 3,
    reused: false,
    diagnostics: [typstError],
    error: { kind: "typst", message: "Typst encontró 1 error" },
    ...overrides,
  };
}

const store = () => useCompilationStore.getState();

beforeEach(() => {
  useCompilationStore.setState(useCompilationStore.getInitialState(), true);
});

describe("store de la compilación", () => {
  it("empieza ocioso y sin resultado", () => {
    expect(store()).toMatchObject({
      status: "idle",
      revision: null,
      ms: null,
      diagnostics: [],
      error: null,
      pages: [],
    });
  });

  it("compilation:start pasa a compilando y conserva lo que había", () => {
    store().finish(finished({ pages: ["<svg>bueno</svg>"] }));
    store().start({ revision: 2 });
    expect(store()).toMatchObject({ status: "compiling", pages: ["<svg>bueno</svg>"] });
  });

  it("compilation:finish pasa a listo con páginas, tiempo y avisos", () => {
    const warning: Diagnostic = { severity: "warning", message: "cuidado", hints: [], element_id: null };
    store().start({ revision: 1 });
    store().finish(finished({ pages: ["<svg>1</svg>", "<svg>2</svg>"], diagnostics: [warning], reused: true }));

    expect(store()).toMatchObject({
      status: "ready",
      revision: 1,
      ms: 12,
      reused: true,
      diagnostics: [warning],
      error: null,
      pages: ["<svg>1</svg>", "<svg>2</svg>"],
    });
  });

  it("compilation:error pasa a error con sus diagnósticos y conserva las páginas buenas", () => {
    store().finish(finished({ pages: ["<svg>bueno</svg>"] }));
    store().fail(failed({ revision: 2 }));

    expect(store()).toMatchObject({
      status: "error",
      revision: 2,
      ms: 3,
      error: { kind: "typst" },
      pages: ["<svg>bueno</svg>"],
    });
    expect(store().diagnostics[0]?.element_id).toBe("c1");
  });

  it("tras un error, una compilación buena lo limpia", () => {
    store().fail(failed({ revision: 1 }));
    store().finish(finished({ revision: 2, pages: ["<svg>arreglado</svg>"] }));
    expect(store()).toMatchObject({ status: "ready", error: null, diagnostics: [], pages: ["<svg>arreglado</svg>"] });
  });

  it("los eventos de una revisión anterior llegan tarde y se ignoran", () => {
    store().finish(finished({ revision: 3, pages: ["<svg>nuevo</svg>"] }));
    store().start({ revision: 2 });
    store().finish(finished({ revision: 2, pages: ["<svg>viejo</svg>"] }));
    store().fail(failed({ revision: 1 }));

    expect(store()).toMatchObject({ status: "ready", revision: 3, pages: ["<svg>nuevo</svg>"] });
  });

  it("reset vuelve al principio, sin páginas", () => {
    store().finish(finished());
    store().reset();
    expect(store()).toMatchObject({ status: "idle", revision: null, pages: [] });
  });
});

describe("expect: se ha abierto otro documento", () => {
  it("quita lo del documento anterior y espera la compilación del nuevo", () => {
    store().finish(finished({ revision: 1, pages: ["<svg>anterior</svg>"] }));
    store().expect(2);
    expect(store()).toMatchObject({ status: "compiling", revision: null, pages: [], error: null });

    // Lo que llegue del documento anterior ya no vale.
    store().finish(finished({ revision: 1, pages: ["<svg>anterior</svg>"] }));
    expect(store().pages).toEqual([]);

    store().finish(finished({ revision: 2, pages: ["<svg>nuevo</svg>"] }));
    expect(store()).toMatchObject({ status: "ready", pages: ["<svg>nuevo</svg>"] });
  });

  it("si el resultado del nuevo llegó antes que la respuesta de abrir, se conserva", () => {
    store().start({ revision: 2 });
    store().finish(finished({ revision: 2, pages: ["<svg>nuevo</svg>"] }));
    store().expect(2);
    expect(store()).toMatchObject({ status: "ready", pages: ["<svg>nuevo</svg>"] });
  });
});
