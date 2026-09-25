// @vitest-environment node
/**
 * Las pestañas del panel lateral caben en él.
 *
 * El panel mide 280 px y no se desplaza en horizontal (`overflow-x:
 * hidden`). Con las siete pestañas en una sola fila, «Variables», «Lote» y
 * «Código» quedaban fuera: no se podían pulsar con el ratón, y llegar a ellas
 * con el teclado descolocaba el panel entero. Se vio al hacer las capturas
 * del manual (F8-08, #95). La hoja de estilos tiene que dejarlas bajar a una
 * segunda fila.
 *
 * Y lo que va debajo de las pestañas tiene que desplazarse dentro de su
 * caja: un CSV cargado en «Lote» se salía y se montaba encima del inspector.
 *
 * Lleva `.node` en el nombre por lo mismo que `tokens.node.test.ts`: lee la
 * hoja de estilos del disco, porque Vitest deja vacío todo lo que es CSS.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const css = readFileSync(fileURLToPath(new URL("../styles.css", import.meta.url)), "utf8").replace(
  /\/\*[\s\S]*?\*\//gu,
  "",
);

/** El cuerpo de la regla con ese selector exacto. */
function rule(selector: string): string {
  const match = new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\s*\\{([^}]*)\\}`, "u").exec(css);
  expect(match, `falta ${selector}`).not.toBeNull();
  return match?.[2] ?? "";
}

describe("el panel lateral", () => {
  it("no se desplaza en horizontal", () => {
    expect(rule(".sidebar")).toMatch(/overflow-x:\s*hidden/u);
  });

  it("sus pestañas bajan a otra fila en vez de salirse", () => {
    expect(rule(".side-tabs")).toMatch(/flex-wrap:\s*wrap/u);
  });

  it("el panel que se ve se desplaza dentro de su caja en vez de salirse", () => {
    const panel = rule(".side-panels > :not(.side-tabs)");
    expect(panel).toMatch(/overflow-y:\s*auto/u);
    expect(panel).toMatch(/min-height:\s*0/u);
  });
});
