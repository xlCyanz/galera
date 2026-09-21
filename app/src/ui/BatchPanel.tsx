/**
 * El panel de lote: la tabla con la que se generarán muchos documentos.
 *
 * Se elige un CSV, se mira **qué columna le toca a cada variable** y se ven
 * las primeras filas con los valores que tendrían. Generar los documentos
 * es F6-06; aquí se prepara y, sobre todo, **se dice lo que está mal antes**
 * de generar nada.
 *
 * Leer el archivo, adivinar el separador y la codificación, emparejar las
 * columnas y decidir qué fila está incompleta lo hace el núcleo
 * (`galera_core::batch::csv`, principio 5).
 */
import { useState } from "react";

import { type LoadedCsv, checkRows, chooseCsv, errorMessage, readCsv } from "../commands";
import { useOpenDocument } from "../store/document";
import type { Encoding } from "../types/batch";

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

  if (document === null) {
    return null;
  }
  const variables = Object.keys(document.variables);

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
        </>
      )}
    </section>
  );
}
