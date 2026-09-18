/**
 * El selector de fuente de un texto, en el inspector.
 *
 * Solo ofrece las familias de las fuentes del proyecto (`fontFamilies`):
 * un texto no puede usar una tipografía que no viaja con el documento
 * (principio 4). Si el texto ya usa una que no está, se enseña marcada para
 * que se vea el problema, pero no se puede volver a elegir.
 *
 * Cambiarla es un `SetProperty` del estilo: entra en el historial.
 */
import { useEffect, useState } from "react";

import { applyOp, fontFamilies } from "../commands";
import { useDocumentStore, useOpenDocument } from "../store/document";
import type { TextStyle } from "../types/model";

export interface FontSelectProps {
  /** El texto. */
  id: string;
  /** Su estilo de ahora. */
  style: TextStyle;
}

export function FontSelect({ id, style }: FontSelectProps) {
  const document = useOpenDocument();
  const fonts = document?.fonts;
  const [families, setFamilies] = useState<string[] | null>(null);

  // Solo cambian cuando cambian las fuentes que declara el documento.
  const key = fonts?.join("\n") ?? "";
  useEffect(() => {
    let gone = false;
    fontFamilies()
      .then((found) => {
        if (!gone) {
          setFamilies(found);
        }
      })
      .catch(() => {
        if (!gone) {
          setFamilies([]);
        }
      });
    return () => {
      gone = true;
    };
  }, [key]);

  const known = families?.some((family) => family.toLowerCase() === style.font.toLowerCase()) ?? true;

  return (
    <label className="font-select">
      <span>Fuente</span>
      <select
        aria-label="Fuente"
        value={style.font}
        disabled={families === null}
        onChange={(event) => {
          const font = event.currentTarget.value;
          void applyOp({ op: "set_property", id, property: { name: "style", value: { ...style, font } } })
            .then((applied) => useDocumentStore.getState().applyEdit(applied))
            .catch(() => undefined);
        }}
      >
        {!known && (
          <option value={style.font} disabled>
            {style.font} (no está en el proyecto)
          </option>
        )}
        {(families ?? [style.font]).map((family) => (
          <option key={family} value={family}>
            {family}
          </option>
        ))}
      </select>
    </label>
  );
}
