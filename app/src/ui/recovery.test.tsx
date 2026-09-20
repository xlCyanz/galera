import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { OpenedProject, Recovery } from "../commands";
import { useDocumentStore } from "../store/document";
import { CloseDialog } from "./CloseDialog";
import { RecoveryNotice, howLongAgo } from "./RecoveryNotice";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const document_ = {
  version: 1,
  meta: { title: "Informe" },
  fonts: [],
  assets: {},
  variables: {},
  pages: [{ id: "p1", size: { width: 210, height: 297, unit: "mm" as const }, elements: [] }],
};

const opened: OpenedProject = {
  root: "/proyectos/informe",
  revision: 2,
  archive: null,
  document: document_,
};

let container: HTMLDivElement;
let root: Root;
let calls: Array<{ command: string; args: unknown }>;
let pending: Recovery[];
let recoverFails: string | null;
let saveFails: string | null;
let recovered: OpenedProject[];

beforeEach(() => {
  calls = [];
  recovered = [];
  recoverFails = null;
  saveFails = null;
  pending = [
    { target: "/proyectos/informe", savedAt: Date.now() / 1000 - 180, projectSavedAt: Date.now() / 1000 - 3600 },
  ];
  mockIPC((command, args) => {
    calls.push({ command, args });
    if (command === "pending_recoveries") {
      return pending;
    }
    if (command === "recover") {
      if (recoverFails !== null) {
        throw { kind: "archive", message: recoverFails };
      }
      return opened;
    }
    if (command === "save_project") {
      if (saveFails !== null) {
        throw { kind: "archive", message: saveFails };
      }
      return { path: "/proyectos/informe", root: "/proyectos/informe", archive: null, revision: 3 };
    }
    return null;
  });
  useDocumentStore.setState(useDocumentStore.getInitialState(), true);
  container = window.document.createElement("div");
  window.document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  act(() => root.unmount());
  container.remove();
  await settle();
  clearMocks();
});

async function settle() {
  await act(async () => {
    for (let i = 0; i < 4; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}

const button = (text: string) => [...container.querySelectorAll("button")].find((b) => b.textContent === text);

async function click(text: string) {
  await act(async () => button(text)!.click());
  await settle();
}

async function renderNotice() {
  act(() => root.render(<RecoveryNotice onRecovered={(project) => recovered.push(project)} />));
  await settle();
}

describe("howLongAgo", () => {
  it("dice cuánto hace, en palabras", () => {
    expect(howLongAgo(1000, 1030)).toBe("hace menos de un minuto");
    expect(howLongAgo(1000, 1060)).toBe("hace 1 minuto");
    expect(howLongAgo(1000, 1000 + 180)).toBe("hace 3 minutos");
    expect(howLongAgo(1000, 1000 + 7200)).toBe("hace 2 horas");
    expect(howLongAgo(1000, 1000 + 86_400 * 3)).toBe("hace 3 días");
    expect(howLongAgo(1000, 500)).toBe("hace menos de un minuto");
  });
});

describe("aviso de recuperación", () => {
  it("sin copias pendientes no se ve nada", async () => {
    pending = [];
    await renderNotice();
    expect(container.textContent).toBe("");
  });

  it("dice qué proyecto y de cuándo, y recuperar lo abre con cambios sin guardar", async () => {
    await renderNotice();
    expect(container.textContent).toContain("informe");
    expect(container.textContent).toContain("hace 3 minutos");

    await click("Recuperar");
    expect(calls.find((c) => c.command === "recover")?.args).toEqual({ target: "/proyectos/informe" });
    expect(recovered).toEqual([opened]);
    expect(container.textContent).toBe("");
  });

  it("descartar tira la copia y no abre nada", async () => {
    await renderNotice();
    await click("Descartar");
    expect(calls.find((c) => c.command === "discard_recovery")?.args).toEqual({
      target: "/proyectos/informe",
    });
    expect(recovered).toEqual([]);
    expect(container.textContent).toBe("");
  });

  it("si recuperar falla, lo dice y el aviso se queda", async () => {
    recoverFails = "roto.galera: el archivo no es un zip válido o está incompleto";
    await renderNotice();
    await click("Recuperar");
    expect(container.textContent).toContain("no es un zip válido");
    expect(recovered).toEqual([]);
  });

  it("de un proyecto que ya no está, lo avisa", async () => {
    pending = [{ target: "/borrado/informe.galera", savedAt: Date.now() / 1000 - 60, projectSavedAt: null }];
    await renderNotice();
    expect(container.textContent).toContain("ya no está donde estaba");
  });
});

describe("cerrar con cambios sin guardar", () => {
  let ask: (() => void) | null = null;

  async function renderDialog() {
    const subscribe = (handler: () => void) => {
      ask = handler;
      return Promise.resolve(() => {
        ask = null;
      });
    };
    act(() => root.render(<CloseDialog subscribe={subscribe} />));
    await settle();
  }

  it("no se ve hasta que el backend avisa", async () => {
    await renderDialog();
    expect(container.textContent).toBe("");
    act(() => ask!());
    expect(container.textContent).toContain("Hay cambios sin guardar");
  });

  it("guardar y salir guarda antes de cerrar", async () => {
    await renderDialog();
    act(() => ask!());
    await click("Guardar y salir");
    expect(calls.map((c) => c.command)).toContain("save_project");
    expect(calls.map((c) => c.command)).toContain("close_window");
    expect(useDocumentStore.getState().dirty).toBe(false);
  });

  it("salir sin guardar cierra sin guardar; cancelar no hace nada", async () => {
    await renderDialog();
    act(() => ask!());
    await click("Salir sin guardar");
    expect(calls.map((c) => c.command)).not.toContain("save_project");
    expect(calls.map((c) => c.command)).toContain("close_window");

    act(() => ask!());
    await click("Cancelar");
    expect(container.textContent).toBe("");
    expect(calls.filter((c) => c.command === "close_window")).toHaveLength(1);
  });

  it("si guardar falla, no se cierra y se dice por qué", async () => {
    saveFails = "no se puede escribir /proyectos/informe: permiso denegado";
    await renderDialog();
    act(() => ask!());
    await click("Guardar y salir");
    expect(container.textContent).toContain("permiso denegado");
    expect(calls.map((c) => c.command)).not.toContain("close_window");
  });
});
