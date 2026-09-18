/**
 * El panel de fuentes: las que declara el documento, las únicas que puede
 * usar un texto (principio 4). Nunca se listan las del sistema.
 *
 * - Cada una con una **muestra dibujada por Typst** con ese mismo archivo,
 *   sus familias, su peso y cuántos textos la necesitan.
 * - **Añadir…** abre el diálogo nativo: el archivo se comprueba, se copia a
 *   `fonts/` y se declara. Lo que no es una fuente se rechaza con su motivo.
 * - **Quitar** solo deja quitar una que no necesita ningún texto; si no,
 *   avisa y dice cuáles. Es un comando del historial; el archivo se queda
 *   en la carpeta del proyecto.
 */
import { useEffect, useState } from "react";

import { type FontInfo, addFont, errorMessage, fontSample, listFonts, removeFont } from "../commands";
import { formatBytes } from "../format";
import { useDocumentStore, useOpenDocument } from "../store/document";

/** La muestra de una fuente, como imagen. */
function Sample({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let created: string | null = null;
    let gone = false;
    setFailed(false);
    fontSample(path)
      .then((svg) => {
        if (gone) {
          return;
        }
        created = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
        setUrl(created);
      })
      .catch(() => {
        if (!gone) {
          setFailed(true);
        }
      });
    return () => {
      gone = true;
      if (created !== null) {
        URL.revokeObjectURL(created);
      }
    };
  }, [path]);

  if (failed) {
    return <div className="font-sample is-missing">Sin muestra</div>;
  }
  return <div className="font-sample">{url !== null && <img src={url} alt="" />}</div>;
}

/** El nombre del archivo de una ruta. */
function fileName(path: string): string {
  return path.split("/").at(-1) ?? path;
}

export function FontsPanel() {
  const document = useOpenDocument();
  const [fonts, setFonts] = useState<FontInfo[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  // Se piden de nuevo con cada cambio del documento: una fuente nueva, o un
  // texto que empieza o deja de usar una.
  useEffect(() => {
    if (document === null) {
      setFonts([]);
      return;
    }
    let gone = false;
    listFonts()
      .then((listed) => {
        if (!gone) {
          setFonts(listed);
        }
      })
      .catch(() => undefined);
    return () => {
      gone = true;
    };
  }, [document]);

  if (document === null) {
    return null;
  }

  const add = () => {
    addFont()
      .then((added) => {
        if (added !== null) {
          useDocumentStore.getState().applyEdit(added);
          setMessage(null);
        }
      })
      .catch((reason: unknown) => setMessage(errorMessage(reason)));
  };

  const remove = (font: FontInfo) => {
    removeFont(font.path)
      .then((removed) => {
        useDocumentStore.getState().applyEdit(removed);
        setMessage(null);
      })
      .catch((reason: unknown) => setMessage(errorMessage(reason)));
  };

  return (
    <section className="assets-panel" aria-label="Fuentes">
      <div className="assets-header">
        <h2>Fuentes</h2>
        <button type="button" onClick={add}>
          Añadir…
        </button>
      </div>
      {message !== null && (
        <p className="assets-message" role="alert">
          {message}
        </p>
      )}
      {fonts.length === 0 ? (
        <p className="layers-empty">El proyecto no tiene fuentes. Añade una para poder usar textos.</p>
      ) : (
        <ul className="assets">
          {fonts.map((font) => (
            <li key={font.path} className="font" data-font={font.path}>
              <Sample path={font.path} />
              <div className="font-row">
                <div className="asset-text">
                  <span className="asset-key" title={font.path}>
                    {font.families.join(", ") || fileName(font.path)}
                  </span>
                  <span className="asset-meta">
                    {font.bytes === null ? "No está en el proyecto" : `${fileName(font.path)} · ${formatBytes(font.bytes)}`}
                    {font.users.length > 0 && ` · en uso (${font.users.length})`}
                  </span>
                </div>
                <button
                  type="button"
                  className="asset-remove"
                  aria-label={`Quitar ${fileName(font.path)}`}
                  title="Dejar de usar en el documento"
                  onClick={() => remove(font)}
                >
                  ×
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
