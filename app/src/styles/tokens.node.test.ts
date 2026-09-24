// @vitest-environment node
/**
 * Los colores de la interfaz viven en `tokens.css` y en ningún otro sitio.
 *
 * Es el criterio de la tarea que hace posible el tema oscuro (F8-01, #88):
 * un color escrito a mano en cualquier otro archivo se quedaría igual al
 * cambiar de tema, y se vería mal en uno de los dos. Estas pruebas lo
 * vigilan para que no vuelva a pasar.
 *
 * Lleva `.node` en el nombre porque lee los archivos del disco con Node, y
 * así la comprueba `tsconfig.node.json`, que trae sus tipos, y no el de la
 * interfaz, que es código de navegador y no debe verlos.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/** `src/`, desde donde se buscan las hojas de estilos. */
const SRC = fileURLToPath(new URL("..", import.meta.url));

/**
 * Se leen del disco y no con `import … ?raw`: Vitest deja vacío todo lo que
 * es CSS, y una prueba sobre un texto vacío pasaría sin mirar nada.
 */
function read(path: string): string {
  return readFileSync(join(SRC, path), "utf8");
}

/** Todas las `.css` de `src/`, con su ruta. */
function cssFiles(dir = SRC): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return cssFiles(path);
    }
    return entry.name.endsWith(".css") ? [relative(SRC, path)] : [];
  });
}

const tokens = read("styles/tokens.css");

/** Los estilos de la aplicación. El spike de IME no: es una página de
 * desarrollo aparte, que no llega a la aplicación construida. */
const stylesheets: Record<string, string> = Object.fromEntries(
  cssFiles()
    .filter((path) => path !== join("styles", "tokens.css") && !path.startsWith(join("text", "spike")))
    .map((path) => [path, read(path)]),
);

/** Lo que escribe estilos desde código: el resaltado del editor de Typst. */
const styledCode: Record<string, string> = {
  "ui/typstHighlight.ts": read("ui/typstHighlight.ts"),
};

/** Los nombres de color de CSS que alguien podría escribir a mano. No
 * están todos, pero sí los que se escapan sin querer. */
const NAMED =
  /\b(?:white|black|red|green|blue|yellow|orange|purple|pink|gray|grey|silver|navy|teal|lime|aqua|magenta|fuchsia|maroon|olive)\b/u;

/** Los colores escritos a mano en un texto, sin contar comentarios. */
function literalColors(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^\s*\/\/.*$/gmu, "");
  const found = [...code.matchAll(/#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\(/gu)].map(
    (match) => match[0],
  );
  // Los nombres, solo en el valor de una propiedad: `.red {` es un selector.
  for (const line of code.split("\n")) {
    const value = line.includes(":") ? line.slice(line.indexOf(":") + 1) : "";
    const named = NAMED.exec(value);
    if (named !== null && !value.includes("var(")) {
      found.push(named[0]);
    }
  }
  return found;
}

/** La luminancia relativa de un `#rrggbb`, según WCAG. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

/** El contraste entre dos colores `#rrggbb`, de 1 a 21. */
function contrast(one: string, other: string): number {
  const [light, dark] = [luminance(one), luminance(other)].sort((a, b) => b - a);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

/** Los tokens que define un bloque de `tokens.css`. */
function definitions(block: string): Map<string, string> {
  return new Map(
    [...block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gu)].map((match) => [
      match[1] ?? "",
      (match[2] ?? "").trim(),
    ]),
  );
}

/** El cuerpo de un bloque, desde su selector hasta su llave de cierre. Sin
 * comentarios: la cabecera de `tokens.css` nombra los selectores. */
function block(css: string, selector: string): string {
  const source = css.replace(/\/\*[\s\S]*?\*\//gu, "");
  const start = source.indexOf(selector);
  expect(start, `falta ${selector}`).toBeGreaterThanOrEqual(0);
  const open = source.indexOf("{", start);
  const close = source.indexOf("}", open);
  return source.slice(open + 1, close);
}

describe("los colores de la interfaz", () => {
  /** El criterio de la tarea: ningún color escrito a mano fuera de los
   * tokens. */
  it("ninguna hoja de estilos escribe un color a mano", () => {
    expect(Object.keys(stylesheets)).toContain("styles.css");
    for (const [path, source] of Object.entries(stylesheets)) {
      // Que no esté vacía: si no, la prueba pasaría sin mirar nada.
      expect(source.length, path).toBeGreaterThan(0);
      expect(literalColors(source), path).toEqual([]);
    }
  });

  it("el resaltado del código tampoco", () => {
    for (const [path, source] of Object.entries(styledCode)) {
      expect(literalColors(source), path).toEqual([]);
    }
  });

  it("todo token que se usa está definido", () => {
    const defined = definitions(tokens);
    for (const [path, source] of Object.entries({ ...stylesheets, ...styledCode })) {
      const used = [...source.matchAll(/var\((--[a-z0-9-]+)/gu)].map((match) => match[1] ?? "");
      const local = definitions(source);
      for (const name of used) {
        expect(defined.has(name) || local.has(name), `${path}: ${name}`).toBe(true);
      }
    }
  });

  /** El criterio de la tarea: todos los tokens de color están definidos
   * para los dos temas. */
  it("el oscuro define lo mismo elegido a mano que venido del sistema", () => {
    const chosen = definitions(block(tokens, ':root[data-theme="dark"]'));
    const system = definitions(block(tokens, ':root:not([data-theme="light"])'));

    expect(chosen.size).toBeGreaterThan(0);
    expect([...system.entries()]).toEqual([...chosen.entries()]);
  });

  it("todo lo que cambia con el tema tiene su valor oscuro", () => {
    const light = definitions(block(tokens, ":root {"));
    const dark = definitions(block(tokens, ':root[data-theme="dark"]'));

    // Lo que el oscuro redefine tiene que existir en el claro...
    for (const name of dark.keys()) {
      expect(light.has(name), name).toBe(true);
    }
    // ...y lo que el claro no deja fijo tiene que redefinirlo el oscuro.
    const fixed = new Set([
      "--paper",
      "--checker-a",
      "--checker-b",
      "--wheel-white",
      "--wheel-black",
      "--wheel-hues",
      "--swatch-none",
      "--handle-fill",
      "--flow",
      "--flow-soft",
      "--on-flow",
      "--cell-guide",
      "--snap",
      "--snap-margin",
      "--snap-halo",
      "--hover-tint",
      "--chip-edge",
    ]);
    for (const name of light.keys()) {
      if (!fixed.has(name)) {
        expect(dark.has(name), `${name} no tiene valor oscuro`).toBe(true);
      }
    }
  });

  /** F8-02 (#89): el foco es siempre visible y cumple el contraste
   * mínimo para lo que no es texto, 3:1 (WCAG 1.4.11). */
  it("el anillo del foco contrasta 3:1 con todo fondo, en los dos temas", () => {
    const light = definitions(block(tokens, ":root {"));
    const dark = new Map([...light, ...definitions(block(tokens, ':root[data-theme="dark"]'))]);

    for (const [theme, values] of [
      ["claro", light],
      ["oscuro", dark],
    ] as const) {
      // Cada anillo, sobre los fondos donde se usa.
      for (const [ring, backgrounds] of [
        ["--focus-ring", ["--bg", "--surface", "--workspace"]],
        ["--focus-ring-on-popover", ["--popover"]],
      ] as const) {
        const color = values.get(ring);
        expect(color, `${theme}: ${ring}`).toBeDefined();
        for (const background of backgrounds) {
          const ratio = contrast(color ?? "", values.get(background) ?? "");
          expect(ratio, `${theme}: ${ring} sobre ${background} da ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });

  /**
   * F8-03 (#90): contraste mínimo de 4,5:1 en texto y 3:1 en controles, en
   * los dos temas. Son las combinaciones que de verdad salen en la
   * interfaz: cada tinta sobre los fondos donde se escribe.
   */
  it("el texto contrasta 4,5:1 y los controles 3:1, en los dos temas", () => {
    const light = definitions(block(tokens, ":root {"));
    const dark = new Map([...light, ...definitions(block(tokens, ':root[data-theme="dark"]'))]);

    const text: Array<[string, string[]]> = [
      ["--ink", ["--bg", "--surface", "--surface-hover"]],
      ["--ink-muted", ["--bg", "--surface"]],
      ["--accent", ["--bg", "--surface"]],
      ["--success", ["--bg", "--surface"]],
      ["--danger", ["--bg", "--surface"]],
      ["--warning", ["--bg", "--surface"]],
      ["--on-accent", ["--accent"]],
      ["--on-notice", ["--notice"]],
      ["--on-caution", ["--caution"]],
      ["--on-danger-soft", ["--danger-soft"]],
      ["--on-popover", ["--popover"]],
      ["--ruler-ink", ["--ruler"]],
      ["--code-comment", ["--surface"]],
      ["--code-keyword", ["--surface"]],
      ["--code-string", ["--surface"]],
      ["--code-number", ["--surface"]],
      ["--code-property", ["--surface"]],
      ["--code-label", ["--surface"]],
    ];
    const controls: Array<[string, string[]]> = [
      ["--control-border", ["--bg", "--surface"]],
      ["--accent", ["--bg", "--surface"]],
    ];

    for (const [theme, values] of [
      ["claro", light],
      ["oscuro", dark],
    ] as const) {
      for (const [pairs, minimum] of [
        [text, 4.5],
        [controls, 3],
      ] as const) {
        for (const [ink, backgrounds] of pairs) {
          for (const background of backgrounds) {
            const ratio = contrast(values.get(ink) ?? "", values.get(background) ?? "");
            expect(
              ratio,
              `${theme}: ${ink} sobre ${background} da ${ratio.toFixed(2)}:1, y hace falta ${minimum}:1`,
            ).toBeGreaterThanOrEqual(minimum);
          }
        }
      }
    }
  });

  it("nadie quita el foco visible, salvo donde se enseña de otra forma", () => {
    // El campo invisible del texto: el foco se ve en el cursor que dibuja el
    // lienzo. Y el contorno de una línea, que no recibe el foco.
    const allowed = new Set([".text-input", ".control-layer.is-line"]);
    for (const [path, source] of Object.entries(stylesheets)) {
      const code = source.replace(/\/\*[\s\S]*?\*\//gu, "");
      for (const match of code.matchAll(/([^{}]+)\{[^{}]*outline:\s*(?:none|0)\b[^{}]*\}/gu)) {
        const selector = (match[1] ?? "").trim();
        expect(allowed.has(selector), `${path}: ${selector} quita el foco visible`).toBe(true);
      }
    }
  });

  /** F8-03 (#90): se respeta la preferencia de movimiento reducido. */
  it("con el movimiento reducido no se anima nada", () => {
    const styles = (stylesheets["styles.css"] ?? "").replace(/\/\*[\s\S]*?\*\//gu, "");
    const start = styles.indexOf("@media (prefers-reduced-motion: reduce)");
    expect(start, "styles.css atiende prefers-reduced-motion").toBeGreaterThanOrEqual(0);
    const rule = styles.slice(start, styles.indexOf("\n}\n", start));
    expect(rule).toContain("animation: none !important");
    expect(rule).toContain("transition: none !important");
    // Y la regla es para todo, no para lo que se anime hoy.
    expect(rule).toMatch(/\*,\s*\*::before,\s*\*::after/u);
  });

  /** El criterio de la tarea: el documento no cambia de color. */
  it("el papel es blanco en los dos temas", () => {
    const light = definitions(block(tokens, ":root {"));
    const dark = definitions(block(tokens, ':root[data-theme="dark"]'));

    expect(light.get("--paper")).toBe("#ffffff");
    expect(dark.has("--paper")).toBe(false);
  });
});
