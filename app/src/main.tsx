import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { applyTheme, storedTheme } from "./theme";
import "./styles/tokens.css";
import "./styles.css";

// El tema va antes de pintar nada: si no, la interfaz saldría un instante
// con el del sistema y luego cambiaría.
applyTheme(storedTheme());

const root = document.getElementById("root");
if (root === null) {
  throw new Error("index.html tiene que tener un elemento #root");
}

// Al desarrollar, `VITE_SPIKE=ime pnpm tauri dev` abre el spike de entrada
// de texto (#55) en vez de la aplicación: es la única forma de probarlo
// dentro del webview de verdad, que es donde vive el IME de macOS. En la
// aplicación construida la condición es falsa y la importación dinámica se
// queda fuera del paquete.
if (import.meta.env.DEV && import.meta.env.VITE_SPIKE === "ime") {
  void import("./text/spike/Ime").then(({ Ime }) =>
    createRoot(root).render(
      <StrictMode>
        <Ime />
      </StrictMode>,
    ),
  );
} else {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
