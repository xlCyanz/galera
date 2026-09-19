import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useDocumentStore } from "../store/document";
import { SidePanels } from "./SidePanels";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  mockIPC((command) => (command === "list_assets" ? [] : null));
  useDocumentStore.setState(useDocumentStore.getInitialState(), true);
  useDocumentStore.getState().open({
    root: "/p",
    revision: 1,
    archive: null,
    document: { version: 1, meta: { title: "x" }, fonts: [], assets: {}, variables: {}, pages: [{ id: "p1", size: { width: 1, height: 1, unit: "mm" }, elements: [] }] },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<SidePanels />));
});

afterEach(async () => {
  act(() => root.unmount());
  container.remove();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  clearMocks();
});

describe("paneles laterales", () => {
  it("enseñan capas o recursos según la pestaña", async () => {
    const tab = (label: string) => [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((t) => t.textContent === label)!;
    expect(tab("Capas").getAttribute("aria-selected")).toBe("true");
    expect(container.querySelector('[aria-label="Capas"]')).not.toBeNull();
    await act(async () => {
      tab("Recursos").click();
    });
    expect(tab("Recursos").getAttribute("aria-selected")).toBe("true");
    expect(container.querySelector('[aria-label="Recursos"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Capas"]')).toBeNull();
  });
});
