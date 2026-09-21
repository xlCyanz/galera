import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { OpenedProject, TemplateCard } from "../commands";
import type { ImageLoader } from "../canvas/PageSvg";
import { useDocumentStore } from "../store/document";
import { TemplateGallery } from "./TemplateGallery";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const loader: ImageLoader = {
  createUrl: (svg) => `blob:${svg}`,
  revokeUrl: () => undefined,
  decode: () => Promise.resolve(),
};

const cards: TemplateCard[] = [
  {
    id: "informe",
    name: "Informe sencillo",
    description: "Una portada con banda de color",
    category: "negocio",
    preview: "<svg>portada</svg>",
    variables: ["asunto", "empresa"],
  },
  {
    id: "vacia",
    name: "Sin vista previa",
    description: "No compone",
    category: null,
    preview: null,
    variables: [],
  },
];

const created: OpenedProject = {
  root: "/p/Mi informe",
  archive: null,
  revision: 1,
  document: {
    version: 1,
    meta: { title: "Mi informe" },
    fonts: [],
    assets: {},
    variables: {},
    pages: [{ id: "p1", size: { width: 210, height: 297, unit: "mm" }, elements: [] }],
  },
};

let container: HTMLDivElement;
let root: Root;
/** Lo que se le ha pedido al backend. */
let asked: Array<{ command: string; args: Record<string, unknown> }>;
/** Si el backend contesta que se canceló el diálogo. */
let cancelled: boolean;
/** Si listar las plantillas falla. */
let broken: boolean;

beforeEach(async () => {
  asked = [];
  cancelled = false;
  broken = false;
  mockIPC((command, args) => {
    asked.push({ command, args: args as Record<string, unknown> });
    if (command === "templates") {
      if (broken) {
        throw { kind: "template", message: "no se pueden leer las plantillas" };
      }
      return cards;
    }
    if (command === "new_from_template") {
      return cancelled ? null : created;
    }
    return null;
  });

  useDocumentStore.setState(useDocumentStore.getInitialState(), true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<TemplateGallery loader={loader} />);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  clearMocks();
});

const items = () => [...container.querySelectorAll<HTMLElement>("[data-template]")];
const button = (template: string, label: string) =>
  [...(items().find((one) => one.dataset.template === template)?.querySelectorAll("button") ?? [])].find(
    (one) => one.textContent === label,
  );

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("la galería de plantillas", () => {
  /** El criterio de la tarea: la galería enseña la vista previa. */
  it("lista las plantillas con su vista previa compuesta", async () => {
    expect(items().map((one) => one.dataset.template)).toEqual(["informe", "vacia"]);
    await settle();

    const preview = container.querySelector<HTMLImageElement>(".template img");
    expect(preview?.getAttribute("src")).toBe("blob:<svg>portada</svg>");
    expect(items()[0]?.textContent).toContain("Informe sencillo");
    expect(items()[0]?.textContent).toContain("asunto, empresa");
  });

  it("una plantilla que no compone se enseña igual, sin imagen", () => {
    expect(items()[1]?.querySelector("img")).toBeNull();
    expect(items()[1]?.textContent).toContain("Sin vista previa");
  });

  /** El criterio de la tarea: crear desde una plantilla abre el documento. */
  it("usar una plantilla pide crearla y abre lo que devuelve", async () => {
    act(() => button("informe", "Usar en una carpeta…")?.click());
    await settle();

    expect(asked.at(-1)).toEqual({
      command: "new_from_template",
      args: { id: "informe", archive: false },
    });
    expect(useDocumentStore.getState().document?.meta.title).toBe("Mi informe");
  });

  it("y se puede pedir en un .galera", async () => {
    act(() => button("informe", "Usar en un .galera…")?.click());
    await settle();
    expect(asked.at(-1)?.args).toEqual({ id: "informe", archive: true });
  });

  it("si se cancela el diálogo no se abre nada", async () => {
    cancelled = true;
    act(() => button("informe", "Usar en una carpeta…")?.click());
    await settle();
    expect(useDocumentStore.getState().document).toBeNull();
  });

  it("si el backend no puede listarlas, lo dice", async () => {
    broken = true;
    // Montada de nuevo: así vuelve a preguntar.
    act(() => root.unmount());
    container.remove();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(<TemplateGallery loader={loader} />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain("no se pueden leer las plantillas");
  });
});
