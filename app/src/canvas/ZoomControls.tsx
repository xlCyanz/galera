/** Los botones de zoom sobre el lienzo, con el nivel actual, y el de las reglas. */
import { TOGGLE_RULERS_LABEL, isMac, type ZoomCommand, zoomShortcutLabel } from "../shortcuts";
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
      title={`${name} (${zoomShortcutLabel(command, mac)})`}
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
        title={`Volver al 100 % (${zoomShortcutLabel("reset", mac)})`}
      >
        {label}
      </button>
      {button("in", "+", "Acercar")}
      {button("fit", "Ajustar", "Ajustar a la ventana")}
      <button
        type="button"
        onClick={onToggleRulers}
        aria-pressed={rulersVisible}
        title={`Reglas (${TOGGLE_RULERS_LABEL})`}
      >
        Reglas
      </button>
    </div>
  );
}
