import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { App } from "../App";
import type { OpenedProject, SavedProject } from "../commands";
import { useCompilationStore } from "../store/compilation";
import { useDocumentStore } from "../store/document";
import { useLayoutStore } from "../store/layout";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const document_ = {
  version: 1,
  meta: { title: "Informe" },
  fonts: [],
  assets: {},
  variables: {},
  pages: [{ id: "p1", size: { width: 210, height: 297, unit: "mm" as const }, elements: [] }],
};

const folder: OpenedProject = { root: "/proyectos/informe", revision: 1, archive: null, document: document_ };
const fromArchive: OpenedProject = {
  root: "/tmp/galera/informe-1",
  revision: 1,
  archive: "/proyectos/informe.galera",
  document: document_,
};

let container: HTMLDivElement;
let root: Root;
let calls: Array<{ command: string; args: unknown }>;
/** Lo que contestan los diálogos y el guardado. */
let chosenFolder: string | null;
let chosenFile: string | null;
let savedAs: SavedProject | null;
let saveFails: string | null;

beforeEach(async () => {
  calls = [];
  chosenFolder = folder.root;
  chosenFile = fromArchive.archive;
  savedAs = null;
  saveFails = null;
  mockIPC((command, args) => {
    calls.push({ command, args });
    if (command === "choose_project_folder") {
      return chosenFolder;
    }
    if (command === "choose_project_file") {
      return chosenFile;
    }
    if (command === "open_project") {
      const { path } = args as { path: string };
      return path.endsWith(".galera") ? fromArchive : folder;
    }
    if (command === "save_project") {
      if (saveFails !== null) {
        throw { kind: "archive", message: saveFails };
      }
      const state = useDocumentStore.getState();
      const saved: SavedProject = {
        path: state.archive ?? state.root!,
        root: state.root!,
        archive: state.archive,
        revision: 2,
      };
      return saved;
    }
    if (command === "save_project_as") {
      return savedAs;
    }
    return null;
  });
  useDocumentStore.setState(useDocumentStore.getInitialState(), true);
  useLayoutStore.setState(useLayoutStore.getInitialState(), true);
  useCompilationStore.setState(useCompilationStore.getInitialState(), true);

  container = window.document.createElement("div");
  window.document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<App />));
  await settle();
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

const button = (text: string) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent?.startsWith(text))!;

async function click(text: string) {
  await act(async () => button(text).click());
  await settle();
}

function edited() {
  act(() => {
    useDocumentStore.getState().applyEdit({
      revision: 2,
      document: document_,
      description: "Mover r1",
      undo: "Mover r1",
      redo: null,
    });
  });
}

describe("guardar y abrir", () => {
  it("abre una carpeta o un .galera, y dice a dónde se guarda", async () => {
    await click("Abrir carpeta…");
    expect(calls.some((c) => c.command === "choose_project_folder")).toBe(true);
    expect(useDocumentStore.getState().archive).toBeNull();

    await click("Abrir .galera…");
    expect(calls.some((c) => c.command === "choose_project_file")).toBe(true);
    expect(useDocumentStore.getState().archive).toBe("/proyectos/informe.galera");
    expect(button("Guardar").title).toContain("/proyectos/informe.galera");
  });

  it("marca que hay cambios sin guardar y los guarda con el botón o con ⌘S", async () => {
    await click("Abrir carpeta…");
    expect(button("Guardar").textContent).not.toContain("•");

    edited();
    expect(button("Guardar").textContent).toContain("•");

    await click("Guardar");
    expect(calls.filter((c) => c.command === "save_project")).toHaveLength(1);
    expect(useDocumentStore.getState().dirty).toBe(false);
    expect(container.textContent).toContain("Guardado en /proyectos/informe");

    edited();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true, cancelable: true }));
    });
    await settle();
    expect(calls.filter((c) => c.command === "save_project")).toHaveLength(2);
    expect(useDocumentStore.getState().dirty).toBe(false);
  });

  it("«guardar como» cambia dónde se guarda a partir de entonces", async () => {
    await click("Abrir carpeta…");
    edited();
    savedAs = {
      path: "/otros/informe.galera",
      root: folder.root,
      archive: "/otros/informe.galera",
      revision: 2,
    };
    await click("Guardar como .galera…");
    expect(calls.find((c) => c.command === "save_project_as")?.args).toEqual({ archive: true });
    expect(useDocumentStore.getState().archive).toBe("/otros/informe.galera");
    expect(useDocumentStore.getState().dirty).toBe(false);

    savedAs = { path: "/otros/copia", root: "/otros/copia", archive: null, revision: 3 };
    await click("Guardar como carpeta…");
    expect(calls.filter((c) => c.command === "save_project_as").at(-1)?.args).toEqual({ archive: false });
    expect(useDocumentStore.getState().root).toBe("/otros/copia");
    expect(useDocumentStore.getState().archive).toBeNull();
  });

  it("si se cancela el diálogo no cambia nada, y un error se dice", async () => {
    await click("Abrir carpeta…");
    edited();
    savedAs = null;
    await click("Guardar como .galera…");
    expect(useDocumentStore.getState().archive).toBeNull();
    expect(useDocumentStore.getState().dirty).toBe(true);

    saveFails = "/proyectos/informe.galera ya existe: no se sobrescribe";
    await click("Guardar");
    expect(container.textContent).toContain("ya existe");
    expect(useDocumentStore.getState().dirty).toBe(true);
  });
});
