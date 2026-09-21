/**
 * La parte de arriba de la columna derecha: capas, páginas, recursos,
 * fuentes o variables, con una pestaña para cada uno. El inspector va
 * siempre debajo.
 */
import { useState } from "react";

import { AssetsPanel } from "./AssetsPanel";
import { FontsPanel } from "./FontsPanel";
import { LayersPanel } from "./LayersPanel";
import { PagesPanel } from "./PagesPanel";
import { VariablesPanel } from "./VariablesPanel";

type Tab = "layers" | "pages" | "assets" | "fonts" | "variables";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "layers", label: "Capas" },
  { id: "pages", label: "Páginas" },
  { id: "assets", label: "Recursos" },
  { id: "fonts", label: "Fuentes" },
  { id: "variables", label: "Variables" },
];

export function SidePanels() {
  const [tab, setTab] = useState<Tab>("layers");
  return (
    <div className="side-panels">
      <div className="side-tabs" role="tablist" aria-label="Paneles">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className="side-tab"
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "layers" && <LayersPanel />}
      {tab === "pages" && <PagesPanel />}
      {tab === "assets" && <AssetsPanel />}
      {tab === "fonts" && <FontsPanel />}
      {tab === "variables" && <VariablesPanel />}
    </div>
  );
}
