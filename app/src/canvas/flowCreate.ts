/**
 * Crear una zona de texto con su herramienta: el comando que se manda.
 *
 * Una zona es un trozo de un texto que fluye (`Flow`): el texto y la cadena
 * de zonas por las que pasa viven en el documento, y cada zona dice a qué
 * flujo pertenece. Crear una es, por eso, más de un cambio, y va en un solo
 * lote para que se deshaga de una vez:
 *
 * - **Sin ninguna zona seleccionada**, un flujo nuevo con un texto de
 *   ejemplo y la zona como primera de su cadena.
 * - **Con una zona seleccionada**, la zona nueva **sigue su texto**: entra
 *   en la misma cadena, justo detrás. Así se hace un texto a dos columnas o
 *   que pasa de una página a otra.
 *
 * Las cuentas de la caja son las de cualquier forma (`createGeometry.ts`).
 */
import type { Document, TextStyle } from "../types/model";
import type { Op } from "../types/ops";
import { type ShapeGeometry, shapeElement } from "./createGeometry";

/** El texto con que nace un flujo nuevo. */
export const PLACEHOLDER_FLOW = "Texto que fluye";

/** Un nombre de flujo que no usa nadie: `flujo-1`, `flujo-2`… */
export function newFlowName(document: Document): string {
  for (let n = 1; ; n += 1) {
    const name = `flujo-${n}`;
    if (document.flows?.[name] === undefined) {
      return name;
    }
  }
}

/** La zona seleccionada, si lo seleccionado es una sola zona. */
function selectedZone(document: Document, selection: string[]): { flow: string; id: string } | null {
  if (selection.length !== 1) {
    return null;
  }
  for (const page of document.pages) {
    for (const element of page.elements) {
      if (element.id === selection[0] && element.type === "flow") {
        return { flow: element.flow, id: element.id };
      }
    }
  }
  return null;
}

/**
 * El lote que crea la zona `id` en la página `page`: detrás de la zona
 * seleccionada, o en un flujo nuevo.
 */
export function flowCreateOp(
  document: Document,
  page: string,
  id: string,
  shape: ShapeGeometry,
  style: TextStyle,
  selection: string[],
): Op {
  const after = selectedZone(document, selection);
  if (after !== null) {
    const chain = document.flows?.[after.flow]?.zones ?? [];
    return {
      op: "batch",
      ops: [
        { op: "create", page, index: null, element: shapeElement(id, shape, undefined, after.flow) },
        { op: "link_zone", flow: after.flow, zone: id, index: chain.indexOf(after.id) + 1 },
      ],
    };
  }
  const name = newFlowName(document);
  return {
    op: "batch",
    ops: [
      {
        op: "create_flow",
        name,
        flow: {
          content: [{ text: PLACEHOLDER_FLOW, bold: false, italic: false, underline: false }],
          style: { ...style },
          zones: [],
        },
      },
      { op: "create", page, index: null, element: shapeElement(id, shape, undefined, name) },
      { op: "link_zone", flow: name, zone: id, index: null },
    ],
  };
}
