/**
 * El diálogo de exportar: a qué formato y qué páginas.
 *
 * Los cuatro formatos salen del núcleo (`galera_core::export`): PDF, un SVG
 * o un PNG por página, y el código Typst que genera Galera. La densidad del
 * PNG y qué páginas salen se eligen aquí y se mandan tal cual; dónde se
 * dejan los archivos lo pregunta el diálogo del sistema, ya en el backend.
 *
 * Lo que se exporta no se compila aparte: el documento entero sale de la
 * compilación que se está viendo (principio 2). Un rango sí se compone
 * aparte, porque lo que se entrega es ese rango y no el documento.
 */
import { useRef, useState } from "react";

import { errorMessage, exportAs } from "../commands";
import { useDialogFocus } from "../hooks/useDialogFocus";
import { useCurrentPage, useOpenDocument } from "../store/document";
import type { Format, Pages } from "../types/export";

/** Los formatos, con su nombre y lo que hacen. */
const FORMATS: Array<{ value: string; label: string }> = [
  { value: "pdf", label: "PDF" },
  { value: "svg", label: "SVG (uno por página)" },
  { value: "png", label: "PNG (uno por página)" },
  { value: "typ", label: "Código Typst (.typ)" },
];

/** La densidad que se propone para el PNG: la de imprenta. */
const DEFAULT_PPI = 300;

export interface ExportDialogProps {
  /** Se cierra sin exportar. */
  onClose: () => void;
  /** Ha salido bien: cuántos archivos y dónde. */
  onDone: (message: string) => void;
}

export function ExportDialog({ onClose, onDone }: ExportDialogProps) {
  const document = useOpenDocument();
  const current = useCurrentPage();
  const [format, setFormat] = useState("pdf");
  const [ppi, setPpi] = useState(DEFAULT_PPI);
  const [which, setWhich] = useState<"all" | "only" | "range">("all");
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(1);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  // El foco entra al abrir, no se sale, Esc cierra sin exportar y el foco
  // vuelve al botón que lo abrió.
  useDialogFocus(dialog, { onEscape: onClose });

  if (document === null) {
    return null;
  }
  const count = document.pages.length;

  const chosenFormat = (): Format =>
    format === "png" ? { format: "png", ppi } : ({ format } as Format);

  const chosenPages = (): Pages => {
    if (which === "only") {
      // Dentro se cuentan desde 0; aquí, como se ven.
      return { pages: "only", page: current + 1 };
    }
    if (which === "range") {
      return { pages: "range", from, to };
    }
    return { pages: "all" };
  };

  const run = () => {
    setBusy(true);
    setMessage(null);
    void exportAs(chosenFormat(), chosenPages())
      .then((exported) => {
        if (exported === null) {
          return;
        }
        const [first] = exported.paths;
        onDone(
          exported.paths.length === 1
            ? `Exportado a ${first}`
            : `${exported.paths.length} archivos exportados junto a ${first}`,
        );
        onClose();
      })
      .catch((reason: unknown) => setMessage(errorMessage(reason)))
      .finally(() => setBusy(false));
  };

  return (
    <div
      ref={dialog}
      tabIndex={-1}
      className="export-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="Exportar"
    >
      <label>
        Formato
        <select
          aria-label="Formato"
          value={format}
          disabled={busy}
          onChange={(event) => setFormat(event.currentTarget.value)}
        >
          {FORMATS.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>

      {format === "png" && (
        <label>
          Densidad (ppp)
          <input
            type="number"
            aria-label="Densidad en puntos por pulgada"
            value={ppi}
            min={24}
            max={1200}
            disabled={busy}
            onChange={(event) => setPpi(Number(event.currentTarget.value))}
          />
        </label>
      )}

      <fieldset className="export-pages">
        <legend>Páginas</legend>
        <label>
          <input
            type="radio"
            name="export-pages"
            checked={which === "all"}
            disabled={busy}
            onChange={() => setWhich("all")}
          />
          Todo ({count === 1 ? "1 página" : `${count} páginas`})
        </label>
        <label>
          <input
            type="radio"
            name="export-pages"
            checked={which === "only"}
            disabled={busy}
            onChange={() => setWhich("only")}
          />
          La página actual ({current + 1})
        </label>
        <label>
          <input
            type="radio"
            name="export-pages"
            checked={which === "range"}
            disabled={busy}
            onChange={() => setWhich("range")}
          />
          De
          <input
            type="number"
            aria-label="Primera página"
            value={from}
            min={1}
            max={count}
            disabled={busy || which !== "range"}
            onChange={(event) => setFrom(Number(event.currentTarget.value))}
          />
          a
          <input
            type="number"
            aria-label="Última página"
            value={to}
            min={1}
            max={count}
            disabled={busy || which !== "range"}
            onChange={(event) => setTo(Number(event.currentTarget.value))}
          />
        </label>
      </fieldset>

      {message !== null && (
        <p className="assets-message" role="alert">
          {message}
        </p>
      )}

      <div className="export-actions">
        <button type="button" onClick={run} disabled={busy}>
          Exportar…
        </button>
        <button type="button" onClick={onClose} disabled={busy}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
