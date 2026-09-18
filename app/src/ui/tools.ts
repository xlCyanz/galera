/**
 * Las herramientas del editor, sin DOM: cuáles hay, cómo se llaman, su
 * atajo de una tecla y el cursor que ponen en el lienzo.
 *
 * Los atajos siguen la convención de los editores de diseño (V, T, R, O, L,
 * H). Están todos en `TOOLS`: si el brief de diseño (F1-13) pide otros, se
 * cambian aquí.
 */

export const TOOL_IDS = ["select", "text", "rect", "ellipse", "line", "image", "hand"] as const;
export type Tool = (typeof TOOL_IDS)[number];

export interface ToolInfo {
  id: Tool;
  /** El nombre, para la ayuda y los lectores de pantalla. */
  label: string;
  /** La tecla que la activa, sin modificadores. */
  key: string;
  /** El cursor del lienzo con la herramienta activa. */
  cursor: string;
}

export const TOOLS: readonly ToolInfo[] = [
  { id: "select", label: "Selección", key: "V", cursor: "default" },
  { id: "text", label: "Texto", key: "T", cursor: "text" },
  { id: "rect", label: "Rectángulo", key: "R", cursor: "crosshair" },
  { id: "ellipse", label: "Elipse", key: "O", cursor: "crosshair" },
  { id: "line", label: "Línea", key: "L", cursor: "crosshair" },
  { id: "image", label: "Imagen", key: "I", cursor: "copy" },
  { id: "hand", label: "Mano", key: "H", cursor: "grab" },
];

/** Si la herramienta crea elementos al usarla en el lienzo. */
export function createsElements(tool: Tool): boolean {
  return tool !== "select" && tool !== "hand";
}

/** Lo que hace falta de un evento de teclado. */
type KeyPress = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">;

/**
 * La herramienta que pide una tecla, o `null`. Solo la tecla sola: con ⌘,
 * Ctrl, Alt o Shift es otro atajo (⌘R, ⇧R…).
 */
export function toolForKey(event: KeyPress): Tool | null {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
    return null;
  }
  const key = event.key.toUpperCase();
  return TOOLS.find((tool) => tool.key === key)?.id ?? null;
}

/** Los datos de una herramienta. */
export function toolInfo(tool: Tool): ToolInfo {
  // TOOLS tiene todas: la búsqueda no falla.
  return TOOLS.find((info) => info.id === tool) ?? TOOLS[0]!;
}
