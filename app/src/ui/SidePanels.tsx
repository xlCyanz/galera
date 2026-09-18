/**
 * La parte de arriba de la columna derecha: capas o recursos, con una
 * pestaña para cada uno. El inspector va siempre debajo.
 */
import { useState } from "react";

import { AssetsPanel } from "./AssetsPanel";
import { LayersPanel } from "./LayersPanel";

type Tab = "layers" | "assets";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "layers", label: "Capas" },
  { id: "assets", label: "Recursos" },
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
      {tab === "layers" ? <LayersPanel /> : <AssetsPanel />}
    </div>
  );
}
