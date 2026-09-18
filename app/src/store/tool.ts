/**
 * La herramienta activa del editor (ver `ui/tools.ts`).
 *
 * Es de quien edita, no del documento: abrir otro no la cambia. La que crea
 * un elemento llama a `created()` al terminar, y se vuelve a la de selección
 * para poder mover o ajustar lo que se acaba de crear.
 */
import { create } from "zustand";

import type { Tool } from "../ui/tools";

export interface ToolState {
  tool: Tool;
  /** Cambia de herramienta. */
  setTool: (tool: Tool) => void;
  /** Se ha creado un elemento con la herramienta activa: vuelve a la de selección. */
  created: () => void;
}

export const useToolStore = create<ToolState>()((set) => ({
  tool: "select",
  setTool: (tool) => set({ tool }),
  created: () => set({ tool: "select" }),
}));

/** La herramienta activa. */
export const useTool = () => useToolStore((state) => state.tool);
