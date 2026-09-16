import { beforeEach, describe, expect, it } from "vitest";

import type { RenderedPage } from "../commands";
import type { Diagnostic } from "../types/diagnostic";
import { compileOpenDocument, useCompilationStore } from "./compilation";

function rendered(overrides: Partial<RenderedPage> = {}): RenderedPage {
  return {
    svg: "<svg>1</svg>",
    diagnostics: [],
    error: null,
    ms: 12,
    reused: false,
    revision: 1,
    ...overrides,
  };
}

const typstError = {
  svg: null,
  error: { kind: "typst", message: "Typst encontró 1 error" },
  diagnostics: [
    { severity: "error", message: "unclosed delimiter", hints: [], element_id: "c1" },
  ],
} satisfies Partial<RenderedPage>;

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

  it("start pasa a compilando", () => {
    store().start();
    expect(store().status).toBe("compiling");
  });

  it("finish con todas las páginas bien pasa a listo y guarda SVG, tiempo y avisos", () => {
    const warning: Diagnostic = {
      severity: "warning",
      message: "cuidado",
      hints: [],
      element_id: null,
    };
    store().start();
    store().finish([
      rendered({ svg: "<svg>1</svg>", diagnostics: [warning] }),
      rendered({ svg: "<svg>2</svg>", diagnostics: [warning], reused: true }),
    ]);

    expect(store()).toMatchObject({
      status: "ready",
      revision: 1,
      ms: 12,
      reused: false,
      diagnostics: [warning],
      error: null,
      pages: ["<svg>1</svg>", "<svg>2</svg>"],
    });
  });

  it("si todas las páginas salen de una compilación anterior, lo dice", () => {
    store().finish([rendered({ reused: true }), rendered({ reused: true })]);
    expect(store().reused).toBe(true);
  });

  it("un error pasa a error con sus diagnósticos y conserva las páginas buenas", () => {
    store().finish([rendered({ svg: "<svg>bueno</svg>" })]);
    store().start();
    expect(store().pages).toEqual(["<svg>bueno</svg>"]);

    store().finish([rendered({ ...typstError, revision: 2, ms: 3 })]);
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
    store().finish([rendered({ ...typstError, revision: 1 })]);
    store().finish([rendered({ svg: "<svg>arreglado</svg>", revision: 2 })]);

    expect(store()).toMatchObject({
      status: "ready",
      error: null,
      diagnostics: [],
      pages: ["<svg>arreglado</svg>"],
    });
  });

  it("una respuesta de una revisión anterior llega tarde y se ignora", () => {
    store().finish([rendered({ svg: "<svg>nuevo</svg>", revision: 3 })]);
    store().finish([rendered({ svg: "<svg>viejo</svg>", revision: 2 })]);

    expect(store()).toMatchObject({ revision: 3, pages: ["<svg>nuevo</svg>"] });
  });

  it("fail guarda el rechazo del backend", () => {
    store().finish([rendered({ svg: "<svg>bueno</svg>" })]);
    store().fail({ kind: "nothing_open", message: "no hay ningún proyecto abierto" });

    expect(store()).toMatchObject({
      status: "error",
      error: { kind: "nothing_open" },
      diagnostics: [],
      pages: ["<svg>bueno</svg>"],
    });
  });

  it("reset vuelve al principio, sin páginas", () => {
    store().finish([rendered()]);
    store().reset();
    expect(store()).toMatchObject({ status: "idle", revision: null, pages: [] });
  });
});

describe("compileOpenDocument", () => {
  it("pide todas las páginas a la vez y guarda el resultado", async () => {
    const asked: number[] = [];
    const statuses: string[] = [];
    const unsubscribe = useCompilationStore.subscribe((state) => statuses.push(state.status));

    await compileOpenDocument(3, (page) => {
      asked.push(page);
      return Promise.resolve(rendered({ svg: `<svg>${page}</svg>`, reused: page > 0 }));
    });
    unsubscribe();

    expect(asked).toEqual([0, 1, 2]);
    expect(statuses).toEqual(["compiling", "ready"]);
    expect(store().pages).toEqual(["<svg>0</svg>", "<svg>1</svg>", "<svg>2</svg>"]);
  });

  it("si el backend rechaza, queda en error con su mensaje", async () => {
    await compileOpenDocument(1, () =>
      Promise.reject({ kind: "nothing_open", message: "no hay ningún proyecto abierto" }),
    );
    expect(store()).toMatchObject({ status: "error", error: { kind: "nothing_open" } });
  });

  it("un fallo que no es del backend también queda como error", async () => {
    await compileOpenDocument(1, () => Promise.reject(new Error("se cayó el puente")));
    expect(store()).toMatchObject({
      status: "error",
      error: { kind: "unknown", message: "se cayó el puente" },
    });
  });
});
