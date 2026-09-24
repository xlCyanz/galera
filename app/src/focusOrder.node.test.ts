// @vitest-environment node
/**
 * El orden en que el tabulador recorre la aplicación (F8-02, #89).
 *
 * El orden lo da el documento HTML: el tabulador va de un control al
 * siguiente tal como están escritos. Eso se rompe de dos formas, y las dos
 * se vigilan aquí:
 *
 * - Un `tabIndex` positivo, que salta por delante de todo lo demás y deja el
 *   recorrido en un orden que nadie ve en la pantalla.
 * - Cambiar de sitio las zonas de la ventana en `App.tsx`: el recorrido
 *   tiene que seguir el de la vista —las herramientas, el lienzo, los
 *   paneles, el inspector y la barra de estado—.
 *
 * Lleva `.node` en el nombre porque lee los archivos con Node (ver
 * `styles/tokens.node.test.ts`).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL(".", import.meta.url));

/** Los componentes de la aplicación, sin sus pruebas. */
function components(dir = SRC): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return components(path);
    }
    return entry.name.endsWith(".tsx") && !entry.name.includes(".test.") ? [path] : [];
  });
}

describe("el recorrido del tabulador", () => {
  it("ningún componente se salta el orden con un tabIndex positivo", () => {
    const found = components();
    expect(found.length).toBeGreaterThan(10);
    for (const path of found) {
      const source = readFileSync(path, "utf8");
      const positive = [...source.matchAll(/tabIndex=\{\s*([1-9]\d*)\s*\}/gu)].map((match) => match[0]);
      expect(positive, relative(SRC, path)).toEqual([]);
    }
  });

  /** El criterio de la tarea: el tabulador recorre paneles, herramientas y
   * campos en orden lógico. */
  it("las zonas de la ventana van en el orden en que se ven", () => {
    const app = readFileSync(join(SRC, "App.tsx"), "utf8");
    const order = ["<ToolRail", "<Canvas", "<SidePanels", "<Inspector", "<StatusBar"].map((tag) => {
      const at = app.indexOf(tag);
      expect(at, `${tag} está en App.tsx`).toBeGreaterThanOrEqual(0);
      return at;
    });
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});
