import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it } from "vitest";

import {
  type OpenedProject,
  type SessionStatus,
  chooseProjectFolder,
  errorMessage,
  isCommandError,
  openProject,
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
  document: { version: 1, meta: { title: "Informe anual 2026" }, pages: [{}] },
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
