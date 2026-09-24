/**
 * El tema de la interfaz: claro, oscuro o el del sistema.
 *
 * El tema es un atributo del documento HTML, `data-theme`, y de ahí lo
 * leen los tokens de color (`styles/tokens.css`): con `light` o `dark`
 * manda lo elegido; sin él, `prefers-color-scheme`. Así cambiar de tema no
 * vuelve a pintar nada desde React: cambia un atributo y el navegador hace
 * el resto.
 *
 * La elección se recuerda entre sesiones en `localStorage`, que en Tauri
 * persiste con el webview. Es una preferencia de quien usa el editor, no
 * del documento: no va al JSON ni se exporta, y el papel sigue siendo
 * blanco con cualquier tema (principio 2).
 */

/** Lo que se puede elegir. */
export type ThemeChoice = "system" | "light" | "dark";

/** Las tres, en el orden en que salen en el selector. */
export const THEME_CHOICES: ReadonlyArray<{ value: ThemeChoice; label: string }> = [
  { value: "system", label: "Sistema" },
  { value: "light", label: "Claro" },
  { value: "dark", label: "Oscuro" },
];

/** Dónde se guarda la elección. */
export const THEME_STORAGE_KEY = "galera.theme";

function isChoice(value: unknown): value is ThemeChoice {
  return value === "system" || value === "light" || value === "dark";
}

/**
 * El tema elegido la última vez, o el del sistema si no se eligió ninguno.
 *
 * `localStorage` puede no estar —una ventana privada, datos borrados—, y
 * entonces también vale el del sistema: la interfaz tiene que abrirse igual.
 */
export function storedTheme(): ThemeChoice {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isChoice(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

/** Pone el tema en el documento, sin guardarlo. */
export function applyTheme(choice: ThemeChoice, root: HTMLElement = document.documentElement): void {
  if (choice === "system") {
    delete root.dataset.theme;
  } else {
    root.dataset.theme = choice;
  }
}

/** Elige un tema: lo pone y lo recuerda para la próxima vez. */
export function chooseTheme(choice: ThemeChoice): void {
  applyTheme(choice);
  try {
    if (choice === "system") {
      localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      localStorage.setItem(THEME_STORAGE_KEY, choice);
    }
  } catch {
    // Sin almacenamiento, el tema vale hasta que se cierre la ventana.
  }
}
