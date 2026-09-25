/**
 * Las herramientas del editor, sin DOM: cuáles hay, cómo se llaman, su
 * atajo de una tecla y el cursor que ponen en el lienzo.
 *
 * La tecla de cada una es un atajo del registro (`shortcuts.ts`), que es
 * donde se cambia si hace falta; aquí solo se dice cuál le toca a cada
 * herramienta.
 */
import type { ShortcutId } from "../shortcuts";

export const TOOL_IDS = ["select", "text", "rect", "ellipse", "line", "image", "code", "table", "hand"] as const;
export type Tool = (typeof TOOL_IDS)[number];

export interface ToolInfo {
  id: Tool;
  /** El nombre, para la ayuda y los lectores de pantalla. */
  label: string;
  /** El atajo que la activa. */
  shortcut: ShortcutId;
  /** El cursor del lienzo con la herramienta activa. */
  cursor: string;
}

export const TOOLS: readonly ToolInfo[] = [
  { id: "select", label: "Selección", shortcut: "toolSelect", cursor: "default" },
  { id: "text", label: "Texto", shortcut: "toolText", cursor: "text" },
  { id: "rect", label: "Rectángulo", shortcut: "toolRect", cursor: "crosshair" },
  { id: "ellipse", label: "Elipse", shortcut: "toolEllipse", cursor: "crosshair" },
  { id: "line", label: "Línea", shortcut: "toolLine", cursor: "crosshair" },
  { id: "image", label: "Imagen", shortcut: "toolImage", cursor: "copy" },
  { id: "code", label: "Bloque de código", shortcut: "toolCode", cursor: "crosshair" },
  { id: "table", label: "Tabla", shortcut: "toolTable", cursor: "crosshair" },
  { id: "hand", label: "Mano", shortcut: "toolHand", cursor: "grab" },
];

/** Las herramientas que crean arrastrando sobre el lienzo (`useCreate`). */
export type ShapeTool = Extract<Tool, "rect" | "ellipse" | "line" | "text" | "code" | "table">;

/** Si la herramienta crea arrastrando: todas las que crean, menos la de imagen. */
export function isShapeTool(tool: Tool): tool is ShapeTool {
  return createsElements(tool) && tool !== "image";
}

/** Si la herramienta crea elementos al usarla en el lienzo. */
export function createsElements(tool: Tool): boolean {
  return tool !== "select" && tool !== "hand";
}

/** Los datos de una herramienta. */
export function toolInfo(tool: Tool): ToolInfo {
  // TOOLS tiene todas: la búsqueda no falla.
  return TOOLS.find((info) => info.id === tool) ?? TOOLS[0]!;
}
