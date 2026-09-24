/**
 * El panel de lote: la tabla con la que se generan muchos documentos.
 *
 * Se elige un CSV, se mira **qué columna le toca a cada variable**, se ven
 * las primeras filas con los valores que tendrían y se generan: un PDF por
 * fila o uno solo con todas.
 *
 * Mientras se generan, el panel enseña por qué fila va y deja cancelar. El
 * avance llega del backend con el evento `batch:progress`, así que la
 * ventana no se queda quieta aunque salgan cien documentos.
 *
 * Leer el archivo, adivinar el separador y la codificación, emparejar las
 * columnas, decidir qué fila está incompleta y componer lo hace el núcleo
 * (`galera_core::batch`, principio 5).
 */
import { useEffect, useState } from "react";

import {
  type LoadedCsv,
  cancelBatch,
  checkRows,
  chooseCsv,
  errorMessage,
  generateBatch,
  onBatchProgress,
  readCsv,
} from "../commands";
import { useOpenDocument } from "../store/document";
import type { Encoding, Outcome, Progress } from "../types/batch";

/** Cuántas filas se enseñan en la vista previa. */
const PREVIEW_ROWS = 5;

/** Los separadores que se pueden elegir a mano, con su nombre. */
const SEPARATORS: Array<{ value: string; label: string }> = [
  { value: ",", label: "Coma" },
  { value: ";", label: "Punto y coma" },
  { value: "\t", label: "Tabulador" },
  { value: "|", label: "Barra" },
];

/** Las codificaciones, con su nombre. */
const ENCODINGS: Array<{ value: Encoding; label: string }> = [
  { value: "utf8", label: "UTF-8" },
  { value: "latin1", label: "ISO-8859-1" },
];

export function BatchPanel() {
  const document = useOpenDocument();
  const [loaded, setLoaded] = useState<LoadedCsv | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [combined, setCombined] = useState(false);
  const [pattern, setPattern] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [generating, setGenerating] = useState(false);

  // Un solo oyente del avance, mientras el panel esté abierto: el evento
  // llega del backend fila a fila.
  useEffect(() => {
    const subscription = onBatchProgress(setProgress);
    return () => {
      void subscription.then((unlisten) => unlisten());
    };
  }, []);

  if (document === null) {
    return null;
  }
  const variables = Object.keys(document.variables);
  // El patrón que se propone: el nombre sale del valor de la primera
  // variable, que es lo que distingue una fila de otra.
  const name = pattern ?? (variables[0] === undefined ? "documento.pdf" : `{{${variables[0]}}}.pdf`);

  const run = (work: Promise<LoadedCsv | null>) => {
    setBusy(true);
    setMessage(null);
    void work
      .then((found) => {
        if (found !== null) {
          setLoaded(found);
        }
      })
      .catch((reason: unknown) => setMessage(errorMessage(reason)))
      .finally(() => setBusy(false));
  };

  /** Vuelve a leer el archivo con otro separador u otra codificación. */
  const reread = (separator: string | null, encoding: Encoding | null) => {
    if (loaded === null) {
      return;
    }
    run(readCsv(loaded.path, separator ?? loaded.separator, encoding ?? loaded.encoding));
  };

  /** Cambia a mano qué columna rellena una variable. */
  const remap = (name: string, column: number | null) => {
    if (loaded === null) {
      return;
    }
    const mapping = { columns: { ...loaded.mapping.columns, [name]: column } };
    setMessage(null);
    void checkRows({ ...loaded }, mapping)
      .then((checked) => setLoaded({ ...loaded, mapping, checked }))
      .catch((reason: unknown) => setMessage(errorMessage(reason)));
  };

  /** Genera el lote y deja el resultado a la vista. */
  const generate = () => {
    if (loaded === null) {
      return;
    }
    setMessage(null);
    setOutcome(null);
    setProgress({ done: 0, total: loaded.checked.length });
    setGenerating(true);
    void generateBatch(loaded, loaded.mapping, combined, name)
      .then((done) => setOutcome(done))
      .catch((reason: unknown) => setMessage(errorMessage(reason)))
      .finally(() => {
        setGenerating(false);
        setProgress(null);
      });
  };

  const broken = loaded?.checked.filter((row) => row.problems.length > 0) ?? [];

  return (
    <section className="batch-panel" aria-label="Generación en lote">
      <div className="assets-header">
        <h2>Lote</h2>
        <button type="button" disabled={busy} onClick={() => run(chooseCsv())}>
          Elegir CSV…
        </button>
      </div>
      {variables.length === 0 && (
        <p className="layers-empty">
          El documento no tiene variables: sin ellas no hay nada que rellenar por filas.
        </p>
      )}
      {message !== null && (
        <p className="assets-message" role="alert">
          {message}
        </p>
      )}

      {loaded !== null && (
        <>
          <div className="batch-options">
            <label>
              Separador
              <select
                value={loaded.separator}
                onChange={(event) => reread(event.currentTarget.value, null)}
              >
                {SEPARATORS.map(({ value, label }) => (
                  <option key={label} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Codificación
              <select
                value={loaded.encoding}
                onChange={(event) => reread(null, event.currentTarget.value as Encoding)}
              >
                {ENCODINGS.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <p className="batch-count">
              {loaded.checked.length === 1 ? "1 fila" : `${loaded.checked.length} filas`}
              {broken.length > 0 &&
                ` · ${broken.length === 1 ? "1 con problemas" : `${broken.length} con problemas`}`}
            </p>
          </div>

          <ul className="batch-mapping">
            {variables.map((name) => (
              <li key={name} data-variable={name}>
                <span>{name}</span>
                <select
                  aria-label={`Columna de ${name}`}
                  value={loaded.mapping.columns[name] ?? ""}
                  onChange={(event) =>
                    remap(name, event.currentTarget.value === "" ? null : Number(event.currentTarget.value))
                  }
                >
                  <option value="">Sin columna</option>
                  {loaded.headers.map((header, index) => (
                    <option key={`${header}-${index}`} value={index}>
                      {header}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>

          <table className="batch-preview">
            <caption>Las primeras filas, con lo que valdría cada variable</caption>
            <thead>
              <tr>
                <th scope="col">#</th>
                {variables.map((name) => (
                  <th scope="col" key={name}>
                    {name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loaded.checked.slice(0, PREVIEW_ROWS).map((row) => (
                <tr
                  key={row.number}
                  data-row={row.number}
                  className={row.problems.length > 0 ? "is-broken" : ""}
                >
                  <th scope="row">{row.number}</th>
                  {variables.map((name) => {
                    const problem = row.problems.find((one) => one.variable === name);
                    return (
                      <td key={name} title={problem?.message ?? ""}>
                        {problem === undefined ? row.values[name] : `⚠ ${problem.message}`}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>

          <div className="batch-output">
            <label>
              <input
                type="radio"
                name="batch-output"
                checked={!combined}
                disabled={generating}
                onChange={() => setCombined(false)}
              />
              Un PDF por fila
            </label>
            <label>
              <input
                type="radio"
                name="batch-output"
                checked={combined}
                disabled={generating}
                onChange={() => setCombined(true)}
              />
              Un solo PDF con todas
            </label>
            {!combined && (
              <label className="batch-pattern">
                Nombre
                <input
                  type="text"
                  value={name}
                  disabled={generating}
                  aria-label="Patrón del nombre"
                  onChange={(event) => setPattern(event.currentTarget.value)}
                />
              </label>
            )}
          </div>

          {generating ? (
            <div className="batch-progress" role="status">
              <progress value={progress?.done ?? 0} max={progress?.total ?? loaded.checked.length} />
              <span>
                {progress === null
                  ? "Generando…"
                  : `Generando… ${progress.done} de ${progress.total}`}
              </span>
              <button type="button" onClick={() => void cancelBatch()}>
                Cancelar
              </button>
            </div>
          ) : (
            <button type="button" className="batch-generate" disabled={busy} onClick={generate}>
              Generar
            </button>
          )}

          {/* Lo que se anuncia al acabar va en una región que ya estaba: si
              naciera con el resumen, el lector de pantalla no lo diría. */}
          <p className="visually-hidden" role="status">
            {outcome === null
              ? ""
              : `${outcome.written.length === 1 ? "1 documento generado" : `${outcome.written.length} documentos generados`}${outcome.cancelled ? ", cancelado antes de acabar" : ""}${outcome.failures.length > 0 ? `, ${outcome.failures.length} con problemas` : ""}`}
          </p>
          {outcome !== null && (
            <div className="batch-outcome">
              <p>
                {outcome.written.length === 1
                  ? "1 documento generado"
                  : `${outcome.written.length} documentos generados`}
                {outcome.cancelled && " · cancelado antes de acabar"}
              </p>
              {outcome.failures.length > 0 && (
                <ul className="batch-failures">
                  {outcome.failures.map((failure) => (
                    <li key={failure.row} data-failure={failure.row}>
                      {failure.row === 0 ? "El lote" : `Fila ${failure.row}`}: {failure.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
