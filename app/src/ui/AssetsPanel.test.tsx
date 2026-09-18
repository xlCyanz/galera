import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AppliedOp, AssetInfo, FileDrop, ImportedImages, OpenedProject } from "../commands";
import { useDocumentStore } from "../store/document";
import { AssetsPanel } from "./AssetsPanel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const project: OpenedProject = {
  root: "/p",
  revision: 1,
  document: {
    version: 1,
    meta: { title: "x" },
    fonts: [],
    assets: { logo: "assets/logo.png", foto: "assets/foto.jpg" },
    variables: {},
    pages: [
      {
        id: "p1",
        size: { width: 10, height: 10, unit: "mm" },
        elements: [{ type: "image", id: "i1", x: 0, y: 0, w: 1, h: null, rotation: 0, asset: "logo" }],
      },
    ],
  },
};

let container: HTMLDivElement;
let root: Root;
let calls: Array<{ command: string; args: unknown }>;
let drop: ((drop: FileDrop) => void) | null;
let imported: ImportedImages;

/** Lo que diría el backend de los recursos del documento del store. */
function listed(): AssetInfo[] {
  const document = useDocumentStore.getState().document!;
  return Object.entries(document.assets)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, path]) => ({
      key,
      path,
      format: path.endsWith(".png") ? "PNG" : "JPEG",
      mime: path.endsWith(".png") ? "image/png" : "image/jpeg",
      bytes: 2048,
      users: document.pages.flatMap((page) =>
        page.elements.filter((e) => e.type === "image" && e.asset === key).map((e) => e.id),
      ),
    }));
}

beforeEach(async () => {
  calls = [];
  drop = null;
  imported = { applied: null, images: [], rejected: [] };
  URL.createObjectURL = () => "blob:miniatura";
  URL.revokeObjectURL = () => undefined;
  Object.defineProperty(HTMLElement.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => ({ left: 0, top: 0, right: 200, bottom: 300, width: 200, height: 300 }),
  });
  mockIPC((command, args) => {
    calls.push({ command, args });
    if (command === "list_assets") {
      return listed();
    }
    if (command === "asset_data") {
      return new Uint8Array([1, 2, 3]).buffer;
    }
    if (command === "choose_images" || command === "import_images") {
      return imported;
    }
    if (command === "apply_op") {
      const op = (args as { op: { op: string; key?: string; from?: string; to?: string } }).op;
      const document = structuredClone(useDocumentStore.getState().document!);
      if (op.op === "remove_asset") {
        delete document.assets[op.key!];
      } else if (op.op === "rename_asset") {
        if (op.to === "foto") {
          throw { kind: "op", message: 'ya hay un recurso con la clave "foto"' };
        }
        document.assets[op.to!] = document.assets[op.from!]!;
        delete document.assets[op.from!];
        for (const element of document.pages[0]!.elements) {
          if (element.type === "image" && element.asset === op.from) {
            element.asset = op.to!;
          }
        }
      }
      const applied: AppliedOp = { revision: 2, document, description: "x", undo: "x", redo: null };
      return applied;
    }
    return null;
  });
  useDocumentStore.setState(useDocumentStore.getInitialState(), true);
  useDocumentStore.getState().open(project);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const subscribe = (handler: (event: FileDrop) => void) => {
    drop = handler;
    return Promise.resolve(() => undefined);
  };
  await act(async () => {
    root.render(<AssetsPanel subscribeToDrops={subscribe} />);
  });
  await settle();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  clearMocks();
  delete (HTMLElement.prototype as { getBoundingClientRect?: unknown }).getBoundingClientRect;
});

async function settle() {
  await act(async () => {
    for (let i = 0; i < 4; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}

const row = (key: string) => container.querySelector<HTMLElement>(`[data-asset="${key}"]`)!;
const message = () => container.querySelector(".assets-message")?.textContent ?? null;
const ops = () => calls.filter((c) => c.command === "apply_op").map((c) => (c.args as { op: unknown }).op);

describe("panel de recursos", () => {
  it("lista los recursos con miniatura, clave, formato, peso y uso", () => {
    expect([...container.querySelectorAll("[data-asset]")].map((r) => (r as HTMLElement).dataset.asset)).toEqual([
      "foto",
      "logo",
    ]);
    expect(row("logo").querySelector("img")?.getAttribute("src")).toBe("blob:miniatura");
    expect(row("logo").textContent).toContain("PNG · 2 KB");
    expect(row("logo").textContent).toContain("en uso (1)");
    expect(row("foto").textContent).not.toContain("en uso");
  });

  it("quitar uno que se usa avisa y dice quién lo usa, sin mandar nada", async () => {
    act(() => row("logo").querySelector<HTMLButtonElement>(".asset-remove")!.click());
    expect(message()).toBe("«logo» lo usa i1: quítalos o cambia su imagen antes.");
    expect(ops()).toHaveLength(0);
  });

  it("quitar uno sin usar manda RemoveAsset y la lista se actualiza", async () => {
    await act(async () => {
      row("foto").querySelector<HTMLButtonElement>(".asset-remove")!.click();
    });
    await settle();
    expect(ops()).toEqual([{ op: "remove_asset", key: "foto" }]);
    expect(container.querySelector('[data-asset="foto"]')).toBeNull();
  });

  it("doble clic en la clave la renombra, y con ella las imágenes que la usan", async () => {
    const rename = async (key: string, text: string) => {
      act(() => {
        row(key).querySelector(".asset-key")!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      });
      const input = row(key).querySelector<HTMLInputElement>("input")!;
      act(() => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
        setter.call(input, text);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => {
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      });
      await settle();
    };

    await rename("logo", "marca");
    expect(ops()).toEqual([{ op: "rename_asset", from: "logo", to: "marca" }]);
    expect(row("marca")).not.toBeNull();
    const image = useDocumentStore.getState().document!.pages[0]!.elements[0]!;
    expect(image.type === "image" && image.asset).toBe("marca");

    // Una clave que ya existe: el núcleo lo rechaza y se dice.
    await rename("marca", "foto");
    expect(message()).toContain("ya hay un recurso con la clave");
  });

  it("Añadir… abre el diálogo y registra lo elegido; lo que no vale se dice", async () => {
    const document = structuredClone(useDocumentStore.getState().document!);
    document.assets.nuevo = "assets/nuevo.png";
    imported = {
      applied: { revision: 3, document, description: "x", undo: null, redo: null },
      images: [{ key: "nuevo", path: "assets/nuevo.png" }],
      rejected: [{ file: "/x.pdf", message: "x.pdf no es una imagen que Galera sepa usar" }],
    };
    await act(async () => {
      [...container.querySelectorAll("button")].find((b) => b.textContent === "Añadir…")!.click();
    });
    await settle();
    expect(calls.some((c) => c.command === "choose_images")).toBe(true);
    expect(row("nuevo")).not.toBeNull();
    expect(message()).toContain("x.pdf no es una imagen");
  });

  it("soltar archivos sobre el panel los añade; fuera de él, no", async () => {
    act(() => drop!({ type: "over", x: 50, y: 50 }));
    expect(container.querySelector(".assets-panel")!.className).toContain("is-drop-target");
    act(() => drop!({ type: "drop", paths: ["/fotos/a.png"], x: 500, y: 50 }));
    await settle();
    expect(calls.some((c) => c.command === "import_images")).toBe(false);

    act(() => drop!({ type: "drop", paths: ["/fotos/a.png"], x: 50, y: 50 }));
    await settle();
    expect(calls.find((c) => c.command === "import_images")?.args).toEqual({ paths: ["/fotos/a.png"] });
  });
});
