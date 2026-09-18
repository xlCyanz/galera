/**
 * El riel de herramientas: la barra vertical a la izquierda del lienzo con
 * selección, texto, rectángulo, elipse, línea, imagen y mano.
 *
 * Cada botón enseña su icono, y su nombre y atajo en la ayuda. La activa se
 * ve marcada (`aria-pressed`). Los atajos de una tecla se escuchan aquí, en
 * toda la ventana, salvo mientras se escribe.
 */
import { useEffect } from "react";

import { isTypingTarget } from "../shortcuts";
import { useTool, useToolStore } from "../store/tool";
import { TOOL_ICONS } from "./icons";
import { TOOLS, toolForKey } from "./tools";

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
            {TOOL_ICONS[id]}
          </svg>
        </button>
      ))}
    </nav>
  );
}
