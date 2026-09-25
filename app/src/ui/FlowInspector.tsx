/**
 * Una zona de texto en el inspector: de qué texto que fluye es, qué puesto
 * ocupa en su cadena y cómo sacarla de ella.
 *
 * Sacarla no la deja vacía de sentido: pasa a un texto que fluye suyo, vacío
 * y con el mismo estilo (`Op::UnlinkZone`). Lo que se rompe es la cadena: lo
 * que venía después sigue en la zona siguiente de la que se queda.
 *
 * Para **añadir** una zona a la cadena no hace falta nada aquí: con esta
 * seleccionada, se dibuja otra con la herramienta «Zona de texto» y va
 * detrás (`canvas/flowCreate.ts`).
 */
import { applyOp } from "../commands";
import { newFlowName } from "../canvas/flowCreate";
import { useDocumentStore, useOpenDocument } from "../store/document";
import type { Element } from "../types/model";

type Zone = Extract<Element, { type: "flow" }>;

export function FlowInspector({ element }: { element: Zone }) {
  const document = useOpenDocument();
  const chain = document?.flows?.[element.flow]?.zones ?? [];
  const position = chain.indexOf(element.id) + 1;

  const unlink = () => {
    const current = useDocumentStore.getState().document;
    if (current === null) {
      return;
    }
    void applyOp({ op: "unlink_zone", zone: element.id, to: newFlowName(current) })
      .then((applied) => useDocumentStore.getState().applyEdit(applied))
      .catch(() => undefined);
  };

  return (
    <div className="flow-inspector">
      <p>
        Zona {position} de {chain.length} del texto «{element.flow}».
      </p>
      <p className="flow-hint">
        Para que el texto siga en otra zona, con esta seleccionada dibuja otra con la herramienta «Zona de texto».
      </p>
      {chain.length > 1 && (
        <button type="button" onClick={unlink}>
          Sacar de la cadena
        </button>
      )}
    </div>
  );
}
