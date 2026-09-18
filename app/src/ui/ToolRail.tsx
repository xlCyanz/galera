/**
 * El riel de herramientas: la barra vertical a la izquierda del lienzo con
 * selección, texto, rectángulo, elipse, línea, imagen y mano.
 *
 * Cada botón enseña su icono, y su nombre y atajo en la ayuda. La activa se
 * ve marcada (`aria-pressed`). Los atajos de una tecla se escuchan aquí, en
 * toda la ventana, salvo mientras se escribe.
 */
import { type ReactNode, useEffect } from "react";

import { isTypingTarget } from "../shortcuts";
import { useTool, useToolStore } from "../store/tool";
import { TOOLS, type Tool, toolForKey } from "./tools";

/** Iconos de 20 × 20, dibujados con el color del texto. */
const ICONS: Record<Tool, ReactNode> = {
  select: <path d="M5 3l10 7-4.5 1L13 16l-2 1-2.5-5L5 15z" fill="currentColor" />,
  text: <path d="M4 4h12M10 4v12M7 16h6" />,
  rect: <rect x="3.5" y="5.5" width="13" height="9" rx="0.5" />,
  ellipse: <ellipse cx="10" cy="10" rx="6.5" ry="5" />,
  line: <path d="M4 16L16 4" />,
  image: (
    <>
      <rect x="3.5" y="4.5" width="13" height="11" rx="0.5" />
      <path d="M4 14l4-4 3 3 2-2 3 3" />
      <circle cx="13" cy="8" r="1.2" />
    </>
  ),
  hand: (
    <path d="M7 10V5.5a1 1 0 012 0V9m0-4.5V4a1 1 0 012 0v5m0-4a1 1 0 012 0v5m0-3a1 1 0 012 0v5c0 3-2 5-5 5h-1c-2 0-3-1-4-2.5L4.5 12a1 1 0 011.6-1.2L7 12" />
  ),
};

export function ToolRail() {
  const active = useTool();

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target) || event.repeat) {
        return;
      }
      const tool = toolForKey(event);
      if (tool !== null) {
        event.preventDefault();
        useToolStore.getState().setTool(tool);
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  return (
    <nav className="tool-rail" aria-label="Herramientas">
      {TOOLS.map(({ id, label, key }) => (
        <button
          key={id}
          type="button"
          className="tool-button"
          data-tool={id}
          aria-label={label}
          aria-pressed={id === active}
          aria-keyshortcuts={key}
          title={`${label} (${key})`}
          onClick={() => useToolStore.getState().setTool(id)}
        >
          <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
            {ICONS[id]}
          </svg>
        </button>
      ))}
    </nav>
  );
}
