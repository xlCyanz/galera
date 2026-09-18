/**
 * El panel de recursos: las imágenes que el documento registra en `assets`.
 *
 * - Cada una con su miniatura, su clave, su formato, su peso y cuántos
 *   elementos la usan. Si el archivo no está, lo dice.
 * - **Añadir…** abre el diálogo nativo; también se pueden soltar archivos
 *   sobre el panel. Se copian a `assets/` del proyecto y se registran, sin
 *   crear elementos (para eso, soltarlas sobre el lienzo).
 * - **Doble clic en la clave** la renombra, y con ella todas las imágenes que
 *   la usan (`Op::RenameAsset`).
 * - **Quitar** solo deja quitar lo que no usa nadie; si algo lo usa, avisa y
 *   dice qué elementos (`Op::RemoveAsset`). El archivo se queda en la
 *   carpeta del proyecto: solo se quita la clave.
 *
 * Renombrar y quitar son comandos de `ops`: entran en el historial.
 */
import { type KeyboardEvent, useEffect, useRef, useState } from "react";

import {
  type AssetInfo,
  type FileDrop,
  type ImportedImages,
  applyOp,
  assetData,
  chooseImages,
  errorMessage,
  importImages,
  listAssets,
  subscribeToFileDrops,
} from "../commands";
import { formatBytes } from "../format";
import { useDocumentStore, useOpenDocument } from "../store/document";
import type { Op } from "../types/ops";

/** La miniatura de un recurso, a partir de sus bytes. */
function Thumbnail({ asset }: { asset: AssetInfo }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (asset.mime === null) {
      return;
    }
    let created: string | null = null;
    let gone = false;
    assetData(asset.key)
      .then((data) => {
        if (gone || data.byteLength === 0 || asset.mime === null) {
          return;
        }
        created = URL.createObjectURL(new Blob([data], { type: asset.mime }));
        setUrl(created);
      })
      .catch(() => undefined);
    return () => {
      gone = true;
      if (created !== null) {
        URL.revokeObjectURL(created);
      }
    };
  }, [asset.key, asset.path, asset.mime, asset.bytes]);

  return (
    <div className="asset-thumb">{url === null ? <span aria-hidden="true">?</span> : <img src={url} alt="" />}</div>
  );
}

export interface AssetsPanelProps {
  /** Solo para pruebas: cómo escuchar lo que se suelta desde el sistema. */
  subscribeToDrops?: (handler: (drop: FileDrop) => void) => Promise<() => void>;
}

export function AssetsPanel({ subscribeToDrops = subscribeToFileDrops }: AssetsPanelProps) {
  const document = useOpenDocument();
  const [assets, setAssets] = useState<AssetInfo[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ key: string; text: string } | null>(null);
  const [over, setOver] = useState(false);
  const panel = useRef<HTMLElement>(null);

  // La lista se pide de nuevo cada vez que cambia el documento: una clave
  // renombrada, un recurso nuevo o un elemento que deja de usarlo.
  useEffect(() => {
    if (document === null) {
      setAssets([]);
      return;
    }
    let gone = false;
    listAssets()
      .then((listed) => {
        if (!gone) {
          setAssets(listed);
        }
      })
      .catch(() => undefined);
    return () => {
      gone = true;
    };
  }, [document]);

  /** Lo que el backend añadió: el documento nuevo y lo que no pudo añadir. */
  const added = (imported: ImportedImages) => {
    if (imported.applied !== null) {
      useDocumentStore.getState().applyEdit(imported.applied);
    }
    setMessage(imported.rejected.length === 0 ? null : imported.rejected.map((r) => r.message).join("\n"));
  };

  // Soltar archivos sobre el panel los añade al proyecto.
  const onDrop = useRef<(drop: FileDrop) => void>(() => undefined);
  onDrop.current = (drop) => {
    const area = panel.current?.getBoundingClientRect();
    const inside =
      drop.type !== "leave" &&
      area !== undefined &&
      drop.x >= area.left &&
      drop.x <= area.right &&
      drop.y >= area.top &&
      drop.y <= area.bottom;
    if (drop.type !== "drop") {
      setOver(inside);
      return;
    }
    setOver(false);
    if (inside && drop.paths.length > 0) {
      importImages(drop.paths)
        .then(added)
        .catch((reason: unknown) => setMessage(errorMessage(reason)));
    }
  };
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let gone = false;
    subscribeToDrops((drop) => onDrop.current(drop))
      .then((stop) => {
        if (gone) {
          stop();
        } else {
          unlisten = stop;
        }
      })
      .catch(() => undefined);
    return () => {
      gone = true;
      unlisten?.();
    };
  }, [subscribeToDrops]);

  if (document === null) {
    return null;
  }

  const run = (op: Op) => {
    applyOp(op)
      .then((applied) => {
        useDocumentStore.getState().applyEdit(applied);
        setMessage(null);
      })
      .catch((reason: unknown) => setMessage(errorMessage(reason)));
  };

  const remove = (asset: AssetInfo) => {
    if (asset.users.length > 0) {
      const who = asset.users.join(", ");
      setMessage(`«${asset.key}» lo usa${asset.users.length === 1 ? "" : "n"} ${who}: quítalos o cambia su imagen antes.`);
      return;
    }
    run({ op: "remove_asset", key: asset.key });
  };

  const finishRenaming = (commit: boolean) => {
    if (renaming === null) {
      return;
    }
    setRenaming(null);
    const to = renaming.text.trim();
    if (commit && to !== "" && to !== renaming.key) {
      run({ op: "rename_asset", from: renaming.key, to });
    }
  };

  const onRenameKey = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      finishRenaming(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      finishRenaming(false);
    }
  };

  return (
    <section ref={panel} className={over ? "assets-panel is-drop-target" : "assets-panel"} aria-label="Recursos">
      <div className="assets-header">
        <h2>Recursos</h2>
        <button
          type="button"
          onClick={() => {
            chooseImages()
              .then(added)
              .catch((reason: unknown) => setMessage(errorMessage(reason)));
          }}
        >
          Añadir…
        </button>
      </div>
      {message !== null && (
        <p className="assets-message" role="alert">
          {message}
        </p>
      )}
      {assets.length === 0 ? (
        <p className="layers-empty">No hay imágenes. Añádelas o suéltalas aquí.</p>
      ) : (
        <ul className="assets">
          {assets.map((asset) => (
            <li key={asset.key} className="asset" data-asset={asset.key}>
              <Thumbnail asset={asset} />
              <div className="asset-text">
                {renaming?.key === asset.key ? (
                  <input
                    className="layer-rename"
                    aria-label={`Clave de ${asset.key}`}
                    value={renaming.text}
                    autoFocus
                    onFocus={(event) => event.currentTarget.select()}
                    onChange={(event) => setRenaming({ key: asset.key, text: event.currentTarget.value })}
                    onKeyDown={onRenameKey}
                    onBlur={() => finishRenaming(true)}
                  />
                ) : (
                  <span
                    className="asset-key"
                    title={`${asset.path} (doble clic para renombrar)`}
                    onDoubleClick={() => setRenaming({ key: asset.key, text: asset.key })}
                  >
                    {asset.key}
                  </span>
                )}
                <span className="asset-meta">
                  {asset.bytes === null
                    ? "No está en el proyecto"
                    : `${asset.format ?? "Formato desconocido"} · ${formatBytes(asset.bytes)}`}
                  {asset.users.length > 0 && ` · en uso (${asset.users.length})`}
                </span>
              </div>
              <button
                type="button"
                className="asset-remove"
                aria-label={`Quitar ${asset.key}`}
                title="Quitar del documento"
                onClick={() => remove(asset)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
