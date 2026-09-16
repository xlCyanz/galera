import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it } from "vitest";

import {
  type OpenedProject,
  type RenderedPage,
  type SessionStatus,
  chooseProjectFolder,
  errorMessage,
  exportPdf,
  isCommandError,
  openProject,
  renderPage,
  sessionStatus,
} from "./commands";

afterEach(() => {
  clearMocks();
});

const closed: SessionStatus = {
  coreVersion: "0.1.0",
  title: null,
  pageCount: 0,
  compiledIsCurrent: false,
};

describe("sessionStatus", () => {
  it("llama a `session_status` sin argumentos y devuelve su respuesta", async () => {
    const calls: Array<{ command: string; args: unknown }> = [];
    mockIPC((command, args) => {
      calls.push({ command, args });
      return closed;
    });

    await expect(sessionStatus()).resolves.toEqual(closed);
    expect(calls).toEqual([{ command: "session_status", args: {} }]);
  });

  it("propaga el error si el backend falla", async () => {
    mockIPC(() => {
      throw new Error("backend caído");
    });

    await expect(sessionStatus()).rejects.toThrow("backend caído");
  });
});

const informe: OpenedProject = {
  root: "/proyectos/informe",
  revision: 1,
  document: {
    version: 1,
    meta: { title: "Informe anual 2026" },
    fonts: [],
    assets: {},
    variables: {},
    pages: [
      {
        id: "p1",
        size: { width: 210, height: 297, unit: "mm" },
        elements: [
          {
            type: "rect",
            id: "r1",
            x: 0,
            y: 0,
            w: 210,
            h: 15,
            rotation: 0,
            fill: "#1e40af",
            stroke: null,
            radius: 0,
          },
        ],
      },
    ],
  },
};

describe("chooseProjectFolder", () => {
  it("llama a `choose_project_folder` y devuelve la carpeta elegida", async () => {
    const calls: string[] = [];
    mockIPC((command) => {
      calls.push(command);
      return "/proyectos/informe";
    });

    await expect(chooseProjectFolder()).resolves.toBe("/proyectos/informe");
    expect(calls).toEqual(["choose_project_folder"]);
  });

  it("devuelve `null` si se cancela el diálogo", async () => {
    mockIPC(() => null);

    await expect(chooseProjectFolder()).resolves.toBeNull();
  });
});

describe("openProject", () => {
  it("llama a `open_project` con la ruta y devuelve el proyecto", async () => {
    const calls: Array<{ command: string; args: unknown }> = [];
    mockIPC((command, args) => {
      calls.push({ command, args });
      return informe;
    });

    await expect(openProject("/proyectos/informe")).resolves.toEqual(informe);
    expect(calls).toEqual([
      { command: "open_project", args: { path: "/proyectos/informe" } },
    ]);
  });

  it("se rechaza con el `CommandError` del backend", async () => {
    const invalid = {
      kind: "invalid",
      message: "el documento tiene 1 problema",
      problems: [],
    };
    mockIPC(() => {
      throw invalid;
    });

    const reason: unknown = await openProject("/x").catch((error: unknown) => error);
    expect(isCommandError(reason)).toBe(true);
    expect(errorMessage(reason)).toBe("el documento tiene 1 problema");
  });
});

describe("errorMessage", () => {
  it("usa el mensaje de un `CommandError`", () => {
    expect(errorMessage({ kind: "open", message: "no parece un proyecto" })).toBe(
      "no parece un proyecto",
    );
  });

  it("usa el mensaje de un `Error`", () => {
    expect(errorMessage(new Error("se cayó"))).toBe("se cayó");
  });

  it("convierte a texto cualquier otra cosa", () => {
    expect(errorMessage("texto suelto")).toBe("texto suelto");
    expect(errorMessage({ kind: 3 })).toBe("[object Object]");
  });
});

describe("renderPage", () => {
  it("llama a `render_page` con el índice de la página", async () => {
    const rendered: RenderedPage = {
      svg: "<svg/>",
      diagnostics: [],
      error: null,
      ms: 4.2,
      reused: false,
      revision: 1,
    };
    const calls: Array<{ command: string; args: unknown }> = [];
    mockIPC((command, args) => {
      calls.push({ command, args });
      return rendered;
    });

    await expect(renderPage(2)).resolves.toEqual(rendered);
    expect(calls).toEqual([{ command: "render_page", args: { page: 2 } }]);
  });

  it("un documento que no compila llega resuelto, como datos", async () => {
    const failed: RenderedPage = {
      svg: null,
      diagnostics: [
        { severity: "error", message: "unclosed delimiter", hints: [], element_id: "c1" },
      ],
      error: { kind: "typst", message: "Typst encontró 1 error" },
      ms: 3,
      reused: false,
      revision: 2,
    };
    mockIPC(() => failed);

    const page = await renderPage(0);
    expect(page.svg).toBeNull();
    expect(page.error?.kind).toBe("typst");
    expect(page.diagnostics[0]?.element_id).toBe("c1");
  });
});

describe("exportPdf", () => {
  it("llama a `export_pdf` sin argumentos y devuelve dónde se guardó", async () => {
    const calls: Array<{ command: string; args: unknown }> = [];
    mockIPC((command, args) => {
      calls.push({ command, args });
      return { path: "/Informe anual 2026.pdf", bytes: 15215 };
    });

    await expect(exportPdf()).resolves.toEqual({ path: "/Informe anual 2026.pdf", bytes: 15215 });
    expect(calls).toEqual([{ command: "export_pdf", args: {} }]);
  });

  it("devuelve `null` si se cancela el diálogo", async () => {
    mockIPC(() => null);
    await expect(exportPdf()).resolves.toBeNull();
  });

  it("un error de escritura rechaza con su mensaje", async () => {
    mockIPC(() => {
      throw { kind: "write", message: "no se pudo guardar /x.pdf: permiso denegado" };
    });

    const reason: unknown = await exportPdf().catch((error: unknown) => error);
    expect(errorMessage(reason)).toBe("no se pudo guardar /x.pdf: permiso denegado");
  });
});
