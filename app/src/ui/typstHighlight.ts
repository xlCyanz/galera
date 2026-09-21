/**
 * Resaltado del código Typst **que genera Galera**, para CodeMirror 6.
 *
 * No es un analizador de Typst: el editor no lee Typst escrito a mano
 * (principio 1). Es un repaso por encima del código que escribe el propio
 * `codegen`, que es siempre de la misma forma —comentarios con `//`,
 * llamadas `#funcion(...)`, cadenas entre comillas, números con su unidad y
 * etiquetas `<el-id>`—, y sirve para leerlo con los colores de siempre.
 */
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import type { StringStream } from "@codemirror/language";
import { tags } from "@lezer/highlight";

/** Lo que reconoce el repaso, con el nombre que le da CodeMirror. */
export const typstTokens = StreamLanguage.define({
  name: "typst-generado",
  token(stream: StringStream): string | null {
    if (stream.eatSpace()) {
      return null;
    }
    // Comentarios: la cabecera del archivo y el id de cada página.
    if (stream.match("//")) {
      stream.skipToEnd();
      return "comment";
    }
    // Etiquetas: <el-r1>, <grp-g1>.
    if (stream.match(/^<[^>\s]*>/)) {
      return "labelName";
    }
    // Cadenas, que el codegen siempre escribe entre comillas dobles.
    if (stream.match(/^"(?:[^"\\]|\\.)*"/)) {
      return "string";
    }
    // Llamadas y palabras con #: #place, #set, #rect…
    if (stream.match(/^#[A-Za-z][\w-]*/)) {
      return "keyword";
    }
    // Números, con o sin unidad: 10mm, 0.5, 12pt, 15deg.
    if (stream.match(/^-?\d+(\.\d+)?(mm|pt|cm|in|em|deg|%)?/)) {
      return "number";
    }
    // Nombres de parámetro: width:, fill:.
    if (stream.match(/^[A-Za-z][\w-]*(?=\s*:)/)) {
      return "propertyName";
    }
    stream.next();
    return null;
  },
});

/** Los colores, que salen de las variables CSS de la aplicación. */
export const typstHighlightStyle = HighlightStyle.define([
  { tag: tags.comment, color: "var(--code-comment, #64748b)", fontStyle: "italic" },
  { tag: tags.keyword, color: "var(--code-keyword, #7c3aed)" },
  { tag: tags.string, color: "var(--code-string, #16a34a)" },
  { tag: tags.number, color: "var(--code-number, #b45309)" },
  { tag: tags.propertyName, color: "var(--code-property, #2563eb)" },
  { tag: tags.labelName, color: "var(--code-label, #db2777)" },
]);

/** El resaltado entero, listo para las extensiones del editor. */
export const typstHighlight = [typstTokens, syntaxHighlighting(typstHighlightStyle)];
