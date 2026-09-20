/** Arranque de la página del spike (#55). Ver `Ime.tsx`. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { Ime } from "./Ime";

const root = document.getElementById("root");
if (root === null) {
  throw new Error("ime.html tiene que tener un elemento #root");
}

createRoot(root).render(
  <StrictMode>
    <Ime />
  </StrictMode>,
);
