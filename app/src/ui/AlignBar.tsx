/**
 * Alinear y repartir lo que haya seleccionado.
 *
 * Las seis alineaciones —izquierda, centro, derecha, arriba, medio, abajo— y
 * los dos repartos —horizontal y vertical—, con un interruptor para decir
 * **respecto a qué**: a la selección o a la página.
 *
 * Las cuentas no están aquí: las hace el núcleo con las cajas de la
 * compilación que se ve (`ops::align`, principio 5), que es lo único que
 * sabe cuánto mide de alto un texto. Cada botón es un comando y un paso del
 * historial; si nada se mueve, no se apunta nada.
 *
 * Con un solo elemento seleccionado solo tiene sentido respecto a la
 * página: el interruptor se queda ahí y no se puede cambiar.
 */
import { type ReactNode, useState } from "react";

import { alignElements, spreadElements } from "../commands";
import { useDocumentStore, useSelection } from "../store/document";
import type { Alignment, Spread } from "../types/align";

/** Los seis botones de alinear, con su icono. */
const ALIGNMENTS: Array<{ how: Alignment; label: string; icon: ReactNode }> = [
  {
    how: "left",
    label: "Alinear a la izquierda",
    icon: (
      <>
        <path d="M3 2v16" />
        <rect x="6" y="5" width="11" height="3" />
        <rect x="6" y="12" width="7" height="3" />
      </>
    ),
  },
  {
    how: "center_x",
    label: "Centrar en horizontal",
    icon: (
      <>
        <path d="M10 2v16" />
        <rect x="4" y="5" width="12" height="3" />
        <rect x="6" y="12" width="8" height="3" />
      </>
    ),
  },
  {
    how: "right",
    label: "Alinear a la derecha",
    icon: (
      <>
        <path d="M17 2v16" />
        <rect x="3" y="5" width="11" height="3" />
        <rect x="7" y="12" width="7" height="3" />
      </>
    ),
  },
  {
    how: "top",
    label: "Alinear arriba",
    icon: (
      <>
        <path d="M2 3h16" />
        <rect x="5" y="6" width="3" height="11" />
        <rect x="12" y="6" width="3" height="7" />
      </>
    ),
  },
  {
    how: "middle",
    label: "Centrar en vertical",
    icon: (
      <>
        <path d="M2 10h16" />
        <rect x="5" y="4" width="3" height="12" />
        <rect x="12" y="6" width="3" height="8" />
      </>
    ),
  },
  {
    how: "bottom",
    label: "Alinear abajo",
    icon: (
      <>
        <path d="M2 17h16" />
        <rect x="5" y="3" width="3" height="11" />
        <rect x="12" y="7" width="3" height="7" />
      </>
    ),
  },
];

/** Los dos botones de repartir. */
const SPREADS: Array<{ axis: Spread; label: string; icon: ReactNode }> = [
  {
    axis: "horizontal",
    label: "Repartir en horizontal",
    icon: (
      <>
        <rect x="2" y="6" width="3" height="8" />
        <rect x="8.5" y="6" width="3" height="8" />
        <rect x="15" y="6" width="3" height="8" />
      </>
    ),
  },
  {
    axis: "vertical",
    label: "Repartir en vertical",
    icon: (
      <>
        <rect x="6" y="2" width="8" height="3" />
        <rect x="6" y="8.5" width="8" height="3" />
        <rect x="6" y="15" width="8" height="3" />
      </>
    ),
  },
];

export function AlignBar() {
  const selection = useSelection();
  const [toPage, setToPage] = useState(false);
  // Con uno solo no hay selección respecto a la que alinear.
  const alone = selection.length < 2;
  const against = alone || toPage;

  if (selection.length === 0) {
    return null;
  }

  const done = (applied: Awaited<ReturnType<typeof alignElements>>) => {
    if (applied !== null) {
      useDocumentStore.getState().applyEdit(applied);
    }
  };

  return (
    <div className="align-bar">
      <div className="align-buttons" role="group" aria-label="Alinear">
        {ALIGNMENTS.map(({ how, label, icon }) => (
          <button
            key={how}
            type="button"
            className="tool-button"
            aria-label={label}
            title={label}
            onClick={() => {
              void alignElements([...selection], how, against)
                .then(done)
                .catch(() => undefined);
            }}
          >
            <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
              {icon}
            </svg>
          </button>
        ))}
      </div>
      <div className="align-buttons" role="group" aria-label="Repartir">
        {SPREADS.map(({ axis, label, icon }) => (
          <button
            key={axis}
            type="button"
            className="tool-button"
            aria-label={label}
            title={label}
            disabled={alone}
            onClick={() => {
              void spreadElements([...selection], axis, against)
                .then(done)
                .catch(() => undefined);
            }}
          >
            <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
              {icon}
            </svg>
          </button>
        ))}
      </div>
      <label className="align-against">
        <input
          type="checkbox"
          checked={against}
          disabled={alone}
          onChange={(event) => setToPage(event.currentTarget.checked)}
        />
        Respecto a la página
      </label>
    </div>
  );
}
