/**
 * La parte de arriba de la columna derecha: capas, páginas, recursos,
 * fuentes, variables, el lote o el código generado, con una pestaña para
 * cada uno. El inspector va
 * siempre debajo.
 */
import { Suspense, lazy, useState } from "react";

import { AssetsPanel } from "./AssetsPanel";
import { FontsPanel } from "./FontsPanel";
import { BatchPanel } from "./BatchPanel";
import { LayersPanel } from "./LayersPanel";
import { PagesPanel } from "./PagesPanel";
import { VariablesPanel } from "./VariablesPanel";

// El panel de código trae CodeMirror, que pesa: se carga la primera vez
// que se abre su pestaña y no al arrancar.
const CodePanel = lazy(() =>
  import("./CodePanel").then((module) => ({ default: module.CodePanel })),
);

type Tab = "layers" | "pages" | "assets" | "fonts" | "variables" | "batch" | "code";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "layers", label: "Capas" },
  { id: "pages", label: "Páginas" },
  { id: "assets", label: "Recursos" },
  { id: "fonts", label: "Fuentes" },
  { id: "variables", label: "Variables" },
  { id: "batch", label: "Lote" },
  { id: "code", label: "Código" },
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
      {tab === "batch" && <BatchPanel />}
      {tab === "code" && (
        <Suspense fallback={<p className="code-notice">Cargando el código…</p>}>
          <CodePanel />
        </Suspense>
      )}
    </div>
  );
}
