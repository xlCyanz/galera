/** Los botones de zoom sobre el lienzo, con el nivel actual, y el de las reglas. */
import { isMac, shortcutLabel } from "../shortcuts";
import type { ZoomCommand } from "./useCanvasNavigation";

/** El atajo de cada comando de zoom, para enseñarlo. */
const ZOOM_SHORTCUTS = { in: "zoomIn", out: "zoomOut", reset: "zoomReset", fit: "zoomFit" } as const;
import { formatZoom } from "./zoom";

const mac = isMac();

export interface ZoomControlsProps {
  zoom: number;
  onCommand: (command: ZoomCommand) => void;
  rulersVisible: boolean;
  onToggleRulers: () => void;
}

export function ZoomControls({ zoom, onCommand, rulersVisible, onToggleRulers }: ZoomControlsProps) {
  const label = formatZoom(zoom);
  const button = (command: ZoomCommand, text: string, name: string) => (
    <button
      type="button"
      onClick={() => onCommand(command)}
      aria-label={name}
      title={`${name} (${shortcutLabel(ZOOM_SHORTCUTS[command], mac)})`}
    >
      {text}
    </button>
  );

  return (
    <div className="canvas-zoom" role="toolbar" aria-label="Zoom">
      {button("out", "−", "Alejar")}
      <button
        type="button"
        className="canvas-zoom-level"
        onClick={() => onCommand("reset")}
        aria-label={`Zoom ${label}. Volver al 100 %`}
        title={`Volver al 100 % (${shortcutLabel("zoomReset", mac)})`}
      >
        {label}
      </button>
      {button("in", "+", "Acercar")}
      {button("fit", "Ajustar", "Ajustar a la ventana")}
      <button
        type="button"
        onClick={onToggleRulers}
        aria-pressed={rulersVisible}
        title={`Reglas (${shortcutLabel("toggleRulers", mac)})`}
      >
        Reglas
      </button>
    </div>
  );
}
