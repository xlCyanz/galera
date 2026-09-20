/**
 * El riel de herramientas: la barra vertical a la izquierda del lienzo con
 * selección, texto, rectángulo, elipse, línea, imagen y mano.
 *
 * Cada botón enseña su icono, y su nombre y atajo en la ayuda. La activa se
 * ve marcada (`aria-pressed`). Los atajos de una tecla se escuchan aquí, en
 * toda la ventana, salvo mientras se escribe.
 */
import { useShortcut } from "../hooks/useShortcuts";
import { useTool, useToolStore } from "../store/tool";
import { isMac, shortcutLabel } from "../shortcuts";
import { TOOL_ICONS } from "./icons";
import { TOOLS } from "./tools";

const mac = isMac();

export function ToolRail() {
  const active = useTool();

  // Una tecla por herramienta, desde el registro (`shortcuts.ts`).
  for (const { id, shortcut } of TOOLS) {
    useShortcut(shortcut, () => useToolStore.getState().setTool(id));
  }

  return (
    <nav className="tool-rail" aria-label="Herramientas">
      {TOOLS.map(({ id, label, shortcut }) => (
        <button
          key={id}
          type="button"
          className="tool-button"
          data-tool={id}
          aria-label={label}
          aria-pressed={id === active}
          aria-keyshortcuts={shortcutLabel(shortcut, mac)}
          title={`${label} (${shortcutLabel(shortcut, mac)})`}
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
