/**
 * El selector del tema, en la barra de estado: sistema, claro u oscuro.
 *
 * Cambiar de tema solo toca los colores de la interfaz. El papel y lo que
 * se dibuja sobre él se quedan como están, porque lo que se ve tiene que
 * ser lo que se exporta (principio 2). Ver `theme.ts`.
 */
import { useState } from "react";

import { THEME_CHOICES, type ThemeChoice, chooseTheme, storedTheme } from "../theme";

export function ThemeSelect() {
  const [choice, setChoice] = useState<ThemeChoice>(storedTheme);

  return (
    <label className="status-theme">
      <span className="status-theme-label">Tema</span>
      <select
        aria-label="Tema de la interfaz"
        value={choice}
        onChange={(event) => {
          const next = event.target.value as ThemeChoice;
          chooseTheme(next);
          setChoice(next);
        }}
      >
        {THEME_CHOICES.map((one) => (
          <option key={one.value} value={one.value}>
            {one.label}
          </option>
        ))}
      </select>
    </label>
  );
}
