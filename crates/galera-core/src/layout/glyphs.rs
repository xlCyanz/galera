//! Dónde quedó cada glifo de un bloque de texto, según Typst.
//!
//! El cursor y la selección se dibujan sobre el render de Typst, así que sus
//! posiciones tienen que salir del mismo sitio que el render: de la
//! composición, nunca de una medida hecha en la interfaz (principio 3). Este
//! módulo lee el documento compilado y devuelve, para un elemento de texto,
//! un [`Glyph`] por cada glifo dibujado: dónde está, cuánto avanza, en qué
//! línea de las que decidió Typst, y a qué parte del texto del documento
//! corresponde.
//!
//! # De vuelta al texto del documento
//!
//! Lo que Typst dibuja no se parece byte a byte a lo que hay en el modelo:
//!
//! - los glifos no van uno por carácter: una ligadura es un glifo para
//!   varios caracteres, y un carácter de varios bytes es un glifo solo;
//! - la tipografía fina compone `"` como `“`, `--` como `–` y `...` como `…`;
//! - los saltos de línea del documento se emiten como `#linebreak();` y
//!   `#parbreak();`, y Typst reparte además sus propios saltos al justificar.
//!
//! Por eso el índice no se adivina comparando textos: cada glifo trae el
//! lugar del código generado del que salió (su *span*), y este módulo
//! recorre a la vez el código y el texto del documento para traducir ese
//! lugar a un índice en el texto ([`TextMap`]). El recorrido comprueba que
//! los dos van de la mano; si no cuadran, no se devuelve nada en vez de
//! devolver una posición que no es.
//!
//! Un glifo llega hasta donde empieza el siguiente: con una ligadura o con
//! `--`, dos caracteres del documento comparten glifo y el cursor solo puede
//! ponerse en sus extremos.
//!
//! # Coordenadas
//!
//! En milímetros, con el origen arriba a la izquierda de la página y **sin
//! girar**, igual que `x`, `y`, `w` y `h` de [`LayoutBox`](super::LayoutBox):
//! la interfaz gira el elemento entero, glifos incluidos.

use serde::Serialize;
use typst::introspection::{Location, Tag};
use typst::layout::{Abs, Frame, FrameItem, Point};
use typst::syntax::{Source, SpanKind};
use typst::text::TextItem;

use super::LABEL_PREFIX;
use crate::compile::{Compiled, compile};
use crate::error::Result;
use crate::model::{Document, Element};
use crate::project::Project;

/// Dos líneas están a la misma altura si sus líneas base no se separan más
/// que esto. Typst compone cada tramo de una línea por su cuenta, y los de
/// una misma línea comparten línea base salvo el ruido de la coma flotante.
const SAME_LINE: Abs = Abs::raw(1e-9);

/// Un glifo dibujado, con su sitio en la página y en el texto.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "layout.ts"))]
pub struct Glyph {
    /// Dónde empieza, en bytes, el texto que compone este glifo dentro del
    /// texto del elemento (los tramos, uno detrás de otro).
    pub text_index: usize,
    /// La línea en la que quedó, contando desde 0. Las decide Typst: un
    /// salto del documento y uno repartido al ajustar el texto se numeran
    /// igual.
    pub line: usize,
    /// Borde izquierdo de su avance, en mm desde el borde izquierdo de la
    /// página.
    pub x: f64,
    /// Borde superior de su línea, en mm desde el borde superior de la
    /// página.
    pub y: f64,
    /// Lo que avanza la escritura al dibujarlo, en mm. Con `x`, los dos
    /// sitios donde puede ir el cursor.
    pub width: f64,
    /// Alto de la línea a la que pertenece, en mm: de la parte alta de la
    /// fuente a la baja, con su tamaño. Es el alto del cursor.
    pub line_height: f64,
    /// La línea base sobre la que se apoya, en mm desde el borde superior de
    /// la página.
    pub baseline: f64,
}

impl Compiled {
    /// Los glifos del elemento de texto `id`, en el orden en que se
    /// escriben.
    ///
    /// `document` tiene que ser el documento con el que se compiló: de él
    /// sale el texto al que se traducen las posiciones. Si el elemento no
    /// existe, no es un texto, no dibuja nada o su texto no cuadra con el
    /// código generado, la lista sale vacía.
    pub fn glyphs(&self, document: &Document, id: &str) -> Vec<Glyph> {
        let Some(text) = element_text(document, id) else {
            return Vec::new();
        };
        let Some(map) = TextMap::new(self.source(), id, &text) else {
            return Vec::new();
        };

        let mut items = Vec::new();
        for page in self.paged().pages() {
            text_items(&page.frame, id, &mut items);
        }
        place(&items, self.source(), &map)
    }
}

/// Compila un documento y devuelve los glifos de uno de sus textos.
///
/// Es [`compile`] seguido de [`Compiled::glyphs`]. Si también hacen falta
/// las cajas o el SVG, mejor compilar una vez y sacarlo todo del mismo
/// [`Compiled`].
///
/// # Errores
///
/// Los de [`compile`].
pub fn glyphs(document: &Document, project: &Project, id: &str) -> Result<Vec<Glyph>> {
    Ok(compile(document, project)?.glyphs(document, id))
}

/// El texto de un elemento: sus tramos, uno detrás de otro. `None` si el
/// elemento no existe o no es un bloque de texto.
fn element_text(document: &Document, id: &str) -> Option<String> {
    match document.element(id)? {
        Element::Text { content, .. } => {
            Some(content.iter().map(|run| run.text.as_str()).collect())
        }
        _ => None,
    }
}

/// Los textos que dibuja el elemento `id`, con su posición en la página.
///
/// Las marcas `<el-ID>` delimitan lo que dibuja cada elemento, igual que en
/// [`super::page_boxes`]. Las transformaciones de los grupos no se aplican:
/// un elemento girado devuelve las posiciones sin girar.
fn text_items<'a>(frame: &'a Frame, id: &str, out: &mut Vec<(Point, &'a TextItem)>) {
    let mut open: Option<Option<Location>> = None;

    for (position, item) in frame.items() {
        match item {
            FrameItem::Tag(Tag::Start(content, _)) => {
                if open.is_none() && super::element_id(content).as_deref() == Some(id) {
                    open = Some(content.location());
                }
            }
            FrameItem::Tag(Tag::End(location, ..)) => {
                if open == Some(Some(*location)) {
                    open = None;
                }
            }
            FrameItem::Group(group) if open.is_some() => collect(&group.frame, *position, out),
            FrameItem::Text(text) if open.is_some() => out.push((*position, text)),
            _ => {}
        }
    }
}

/// Todos los textos de un marco y de los que lleva dentro, con su posición
/// ya sumada.
fn collect<'a>(frame: &'a Frame, offset: Point, out: &mut Vec<(Point, &'a TextItem)>) {
    for (position, item) in frame.items() {
        let at = offset + *position;
        match item {
            FrameItem::Group(group) => collect(&group.frame, at, out),
            FrameItem::Text(text) => out.push((at, text)),
            _ => {}
        }
    }
}

/// Convierte los textos compuestos en glifos con su posición y su índice.
///
/// Cada texto se dibuja desde el principio de su línea base, y cada glifo
/// avanza lo que diga la fuente: kerning incluido, porque el avance ya viene
/// medido. Los tramos que comparten línea base son la misma línea, aunque
/// vengan en fuentes distintas: una palabra en japonés dentro de un párrafo
/// se compone aparte, con la fuente que la cubra.
fn place(items: &[(Point, &TextItem)], source: &Source, map: &TextMap) -> Vec<Glyph> {
    let mut glyphs = Vec::new();
    let mut line = 0;
    let mut previous: Option<Abs> = None;

    for (position, item) in items {
        if previous.is_some_and(|baseline| (baseline - position.y).abs() > SAME_LINE) {
            line += 1;
        }
        previous = Some(position.y);

        let metrics = item.font.metrics();
        let ascender = metrics.ascender.at(item.size);
        let descender = metrics.descender.at(item.size);
        let mut x = position.x;

        for glyph in &item.glyphs {
            let advance = glyph.x_advance.at(item.size);
            if let Some(text_index) = source_offset(source, glyph).and_then(|at| map.index(at)) {
                glyphs.push(Glyph {
                    text_index,
                    line,
                    x: x.to_mm(),
                    y: (position.y - ascender).to_mm(),
                    width: advance.to_mm(),
                    line_height: (ascender - descender).to_mm(),
                    baseline: position.y.to_mm(),
                });
            }
            x += advance;
        }
    }

    glyphs
}

/// Dónde está el `[` que abre el contenido de una llamada, sin contar los
/// que vayan dentro de una cadena: la dirección de un enlace puede llevar
/// corchetes.
fn opening_bracket(code: &str) -> Option<usize> {
    let mut inside = false;
    let mut escaped = false;
    for (at, character) in code.char_indices() {
        match character {
            _ if escaped => escaped = false,
            '\\' if inside => escaped = true,
            '"' => inside = !inside,
            '[' if !inside => return Some(at),
            _ => {}
        }
    }
    None
}

/// Dónde empieza, en el código generado, el texto del que salió el glifo.
fn source_offset(source: &Source, glyph: &typst::text::Glyph) -> Option<usize> {
    match glyph.span.0.get() {
        SpanKind::Number { id, num } if id == source.id() => {
            Some(source.range(num, None)?.start + usize::from(glyph.span.1))
        }
        _ => None,
    }
}

/// De una posición del código generado al índice en el texto del elemento.
///
/// El codegen escribe el contenido de un texto de una tirada, dentro del
/// `align(…)[…]` de su línea: escapando con `\` lo que sería marcado y
/// poniendo `#linebreak();` o `#parbreak();` donde el documento tiene saltos
/// de línea. Recorrer ese trozo junto al texto del documento da la
/// correspondencia exacta, carácter a carácter.
struct TextMap {
    /// Dónde empieza el contenido en el código generado.
    start: usize,
    /// Por cada byte del contenido, el índice en el texto del elemento.
    indices: Vec<usize>,
}

/// Los saltos de línea que escribe el codegen.
const BREAKS: [&str; 2] = ["#linebreak();", "#parbreak();"];

/// Lo que el codegen escribe alrededor de un tramo con formato. Lo que va
/// entre `[` y `]` sí es texto del documento; el envoltorio, no.
const WRAPPERS: [&str; 5] = ["#emph[", "#strong[", "#underline[", "#text(", "#link("];

impl TextMap {
    /// Recorre el contenido del elemento `id` en `source` junto a su `text`.
    /// `None` si el elemento no está en el código o si los dos no van de la
    /// mano, que sería un error del codegen o de este módulo.
    fn new(source: &Source, id: &str, text: &str) -> Option<Self> {
        let code = source.text();
        let label = code.find(&format!("<{LABEL_PREFIX}{id}>"))?;
        let line = code[..label].rfind('\n').map_or(0, |at| at + 1);
        // El contenido va detrás del `[` del `align(…)` de esa línea. Lo que
        // el texto lleve dentro va escapado, así que el primero es este.
        let align = line + code[line..label].find("align(")?;
        let start = align + code[align..label].find('[')? + 1;

        let mut indices = Vec::new();
        let mut rest = &code[start..];
        let mut at = 0;
        // Cuántos envoltorios de formato hay abiertos: sus `]` no acaban el
        // contenido.
        let mut open = 0usize;

        loop {
            if let Some(brk) = BREAKS.iter().find(|brk| rest.starts_with(**brk)) {
                indices.extend(std::iter::repeat_n(at, brk.len()));
                // Uno o varios saltos seguidos se emiten como un solo
                // marcador: el texto dice cuántos eran.
                let newlines = text[at..]
                    .bytes()
                    .take_while(|byte| matches!(byte, b'\n' | b'\r'))
                    .count();
                if newlines == 0 {
                    return None;
                }
                at += newlines;
                rest = &rest[brk.len()..];
                continue;
            }

            // El marcado del formato no es texto del documento: se salta
            // entero, hasta el `[` que abre el tramo.
            if let Some(wrapper) = WRAPPERS.iter().find(|wrapper| rest.starts_with(**wrapper)) {
                let skip = if wrapper.ends_with('(') {
                    // `#text(fill: …)[` y `#link("…")[`: el argumento lo
                    // escribió el codegen, no el documento.
                    opening_bracket(rest)? + 1
                } else {
                    wrapper.len()
                };
                indices.extend(std::iter::repeat_n(at, skip));
                rest = &rest[skip..];
                open += 1;
                continue;
            }

            let character = rest.chars().next()?;
            if character == ']' {
                if open == 0 {
                    break;
                }
                // Cierra un envoltorio, no el contenido.
                open -= 1;
                indices.push(at);
                rest = &rest[1..];
                continue;
            }

            // Detrás de `\` va el carácter del documento, tal cual.
            let escaped = character == '\\';
            let character = if escaped {
                rest[1..].chars().next()?
            } else {
                character
            };
            if !text[at..].starts_with(character) {
                return None;
            }

            let width = character.len_utf8();
            indices.extend(std::iter::repeat_n(at, width + usize::from(escaped)));
            at += width;
            rest = &rest[width + usize::from(escaped)..];
        }

        // Lo único que puede quedar del texto son los saltos de línea del
        // final, que Typst no dibuja.
        if text[at..]
            .bytes()
            .any(|byte| !matches!(byte, b'\n' | b'\r'))
        {
            return None;
        }

        Some(Self { start, indices })
    }

    /// El índice en el texto del elemento, o `None` si la posición no cae en
    /// su contenido: un glifo de otro elemento, o de algo que puso el
    /// codegen y no el documento.
    fn index(&self, at: usize) -> Option<usize> {
        self.indices.get(at.checked_sub(self.start)?).copied()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testing::{PT_PER_MM, fixture, pdf_text_origins, project};

    /// Una milésima de milímetro, como en el resto del módulo.
    const TOLERANCE: f64 = 1e-3;

    fn glyphs_of(name: &str, id: &str) -> Vec<Glyph> {
        glyphs(&fixture(name), &project(), id).expect("compila")
    }

    /// El texto de un elemento del fixture, tal como lo guarda el documento.
    fn text_of(name: &str, id: &str) -> String {
        element_text(&fixture(name), id).expect("es un texto")
    }

    /// Lo que compone cada glifo: desde su índice hasta el del siguiente.
    fn pieces(text: &str, found: &[Glyph]) -> Vec<String> {
        found
            .iter()
            .enumerate()
            .map(|(at, glyph)| {
                let end = found
                    .get(at + 1)
                    .map_or(text.len(), |next| next.text_index.max(glyph.text_index));
                text[glyph.text_index..end].to_owned()
            })
            .collect()
    }

    fn assert_close(actual: f64, expected: f64, what: &str) {
        assert!(
            (actual - expected).abs() < TOLERANCE,
            "{what}: {actual} y se esperaba {expected}"
        );
    }

    /// El criterio de la tarea: un glifo por cada carácter dibujado, en
    /// orden, y cada uno apunta a su sitio en el texto del documento.
    #[test]
    fn every_glyph_points_at_its_own_text() {
        let text = text_of("texto", "izquierda");
        let found = glyphs_of("texto", "izquierda");
        assert_eq!(pieces(&text, &found).concat(), text);
        assert_eq!(found.len(), text.chars().count());

        let mut previous: Option<&Glyph> = None;
        for glyph in &found {
            assert_eq!(glyph.line, 0, "una sola línea: {glyph:?}");
            assert!(glyph.width > 0.0, "avanza: {glyph:?}");
            assert!(glyph.line_height > 0.0, "tiene alto: {glyph:?}");
            if let Some(previous) = previous {
                assert_close(
                    glyph.x,
                    previous.x + previous.width,
                    "cada uno tras el anterior",
                );
                assert!(
                    glyph.text_index > previous.text_index,
                    "en orden: {glyph:?}"
                );
            }
            previous = Some(glyph);
        }
    }

    /// Un carácter de varios bytes es un glifo solo, y su índice cuenta
    /// bytes: el cursor se mueve por caracteres, no por glifos.
    #[test]
    fn a_character_of_several_bytes_is_one_glyph() {
        let text = text_of("texto", "alto-fijo-y-saltos");
        let found = glyphs_of("texto", "alto-fijo-y-saltos");
        let accented = found
            .iter()
            .find(|glyph| text[glyph.text_index..].starts_with('í'))
            .expect("la í de «línea»");
        assert_eq!(text[accented.text_index..].chars().next(), Some('í'));
        let next = found
            .iter()
            .find(|glyph| glyph.text_index > accented.text_index)
            .expect("hay más");
        assert_eq!(next.text_index, accented.text_index + 'í'.len_utf8());
    }

    /// La tipografía fina cambia lo que se dibuja, no lo que hay escrito:
    /// `“` sale de un `"`, `–` de un `--` y `…` de tres puntos, y cada uno
    /// apunta al primer carácter que compone.
    #[test]
    fn fine_typography_points_at_the_characters_it_replaced() {
        let text = text_of("escape", "tipografia-fina");
        let found = glyphs_of("escape", "tipografia-fina");
        let composed = pieces(&text, &found);
        assert_eq!(composed.concat(), text);
        assert!(
            composed.contains(&"\"".to_owned()),
            "las comillas: {composed:?}"
        );
        assert!(composed.contains(&"--".to_owned()), "la raya: {composed:?}");
        assert!(
            composed.contains(&"...".to_owned()),
            "los puntos: {composed:?}"
        );
        // Tres caracteres menos que glifos: `--` y `...` son un glifo cada
        // uno, y las dos comillas siguen siendo dos.
        assert_eq!(found.len(), text.chars().count() - 3);
    }

    /// Lo que se escapa para que Typst no lo lea como marcado apunta al
    /// carácter del documento, no a la barra que le puso el codegen.
    #[test]
    fn an_escaped_character_points_at_the_document() {
        let text = text_of("escape", "especiales");
        let found = glyphs_of("escape", "especiales");
        assert_eq!(pieces(&text, &found).concat(), text);
        assert_eq!(
            found[0].text_index, 0,
            "la almohadilla es el primer carácter"
        );
        assert_eq!(text[found[0].text_index..].chars().next(), Some('#'));
        assert_eq!(found[1].text_index, 1);
    }

    /// Los saltos del documento y los que reparte Typst se numeran igual, y
    /// el texto de cada línea es el que se ve.
    #[test]
    fn the_lines_are_the_ones_typst_decided() {
        let text = text_of("texto", "alto-fijo-y-saltos");
        let found = glyphs_of("texto", "alto-fijo-y-saltos");
        let starts: Vec<usize> = found
            .iter()
            .enumerate()
            .filter(|(at, glyph)| *at == 0 || found[at - 1].line != glyph.line)
            .map(|(_, glyph)| glyph.text_index)
            .collect();
        assert_eq!(
            starts
                .iter()
                .map(|&at| text[at..].chars().next().expect("hay carácter"))
                .collect::<Vec<char>>(),
            vec!['P', 's', 'O'],
            "una línea por cada salto del documento"
        );
        assert_eq!(found.last().expect("hay glifos").line, 2);

        // El párrafo justificado no lleva saltos escritos: los reparte
        // Typst, y aun así cada línea empieza donde dice el texto.
        let justified = glyphs_of("texto", "justificado");
        let lines = justified.last().expect("hay glifos").line;
        assert!(lines >= 1, "se parte en varias líneas");
        for pair in justified.windows(2) {
            assert!(
                pair[1].text_index > pair[0].text_index,
                "en orden: {pair:?}"
            );
            if pair[0].line != pair[1].line {
                assert!(pair[1].y > pair[0].y, "la línea siguiente va debajo");
                assert!(pair[1].x < pair[0].x, "y vuelve al margen");
            }
        }
    }

    /// Un párrafo con fuentes distintas en la misma línea —el japonés y los
    /// emojis no los cubre Inter— es una sola línea.
    #[test]
    fn several_fonts_in_a_line_are_one_line() {
        let text = text_of("escape", "acentos-emoji-cjk");
        let found = glyphs_of("escape", "acentos-emoji-cjk");
        assert_eq!(pieces(&text, &found).concat(), text);
        assert!(found.iter().all(|glyph| glyph.line == 0), "{found:#?}");
        for pair in found.windows(2) {
            assert!(
                pair[1].text_index > pair[0].text_index,
                "en orden: {pair:?}"
            );
        }
    }

    /// El criterio de la tarea: las posiciones son las del PDF, no una
    /// medida de la interfaz. Cada línea empieza donde Typst escribió su
    /// línea base.
    #[test]
    fn the_positions_are_the_ones_in_the_pdf() {
        let document = fixture("texto");
        let compiled = crate::compile::compile(&document, &project()).expect("compila");
        let pdf = compiled.to_pdf().expect("escribe el PDF");
        let origins = pdf_text_origins(&pdf);

        let mut lines = Vec::new();
        for id in ["izquierda", "centro", "derecha", "justificado"] {
            let found = compiled.glyphs(&document, id);
            for (at, glyph) in found.iter().enumerate() {
                if at == 0 || found[at - 1].line != glyph.line {
                    lines.push((glyph.x, glyph.baseline));
                }
            }
        }

        for (x, baseline) in lines {
            let found = origins.iter().any(|&(left, top)| {
                (left / PT_PER_MM - x).abs() < TOLERANCE
                    && (top / PT_PER_MM - baseline).abs() < TOLERANCE
            });
            assert!(
                found,
                "ninguna línea del PDF empieza en ({x}, {baseline}): {origins:?}"
            );
        }
    }

    /// Los glifos caen dentro de la caja del elemento: es la misma
    /// composición. Con la altura hay un matiz: la caja de Typst va de la
    /// altura de las mayúsculas a la línea base, y el alto que se devuelve
    /// es el de la fuente entera, que sobresale un poco por arriba y por
    /// abajo. El cursor tapa así las tildes y los rabos.
    #[test]
    fn the_glyphs_stay_inside_the_box() {
        let document = fixture("texto");
        let compiled = crate::compile::compile(&document, &project()).expect("compila");
        let boxes = compiled.layout();
        for id in [
            "izquierda",
            "justificado",
            "alto-fijo-y-saltos",
            "espaciado",
        ] {
            let element = boxes.iter().find(|box_| box_.id == id).expect("tiene caja");
            for glyph in compiled.glyphs(&document, id) {
                assert!(glyph.x >= element.x - TOLERANCE, "{id}: {glyph:?}");
                assert!(
                    glyph.x + glyph.width <= element.x + element.w + TOLERANCE,
                    "{id}: {glyph:?}"
                );
                assert!(glyph.baseline >= element.y - TOLERANCE, "{id}: {glyph:?}");
                assert!(
                    glyph.baseline <= element.y + element.h + TOLERANCE,
                    "{id}: {glyph:?}"
                );
                assert!(glyph.y >= element.y - glyph.line_height, "{id}: {glyph:?}");
            }
        }
    }

    /// El marcado del formato no estorba: lo que Typst dibuja sigue
    /// apuntando al texto del documento, tramo a tramo.
    #[test]
    fn formatted_runs_still_point_at_the_document() {
        for id in ["mezcla", "saltos"] {
            let text = text_of("formato", id);
            let found = glyphs_of("formato", id);
            assert!(!found.is_empty(), "{id} dibuja algo");
            assert_eq!(pieces(&text, &found).concat(), text, "{id}");
        }

        // Un enlace también se salta entero, con su destino: lo que se
        // dibuja es el texto, no la dirección.
        let text = text_of("formato", "mezcla");
        let found = glyphs_of("formato", "mezcla");
        let web = text.find("la web").expect("el fixture lleva un enlace");
        let glyph = found
            .iter()
            .find(|glyph| glyph.text_index == web)
            .unwrap_or_else(|| panic!("falta el glifo de la «l» de «la web»: {found:#?}"));
        assert_eq!(text[glyph.text_index..].chars().next(), Some('l'));

        // Y las líneas siguen siendo las que decidió Typst: el salto de
        // párrafo está repartido entre dos tramos con formatos distintos.
        let lines = glyphs_of("formato", "saltos")
            .last()
            .expect("hay glifos")
            .line;
        assert_eq!(lines, 1);
    }

    /// Lo que no es un bloque de texto no tiene glifos: ni un rectángulo, ni
    /// un elemento que no existe, ni un bloque de código, cuyo contenido no
    /// sale del texto del documento.
    #[test]
    fn what_is_not_a_text_has_no_glyphs() {
        assert!(glyphs_of("rectangulo", "relleno").is_empty());
        assert!(glyphs_of("texto", "no-existe").is_empty());
        assert!(glyphs_of("codigo", "tabla").is_empty());
    }

    #[test]
    fn a_glyph_serializes_with_its_line_and_its_index() {
        let found = glyphs_of("texto", "izquierda");
        let json = serde_json::to_value(found[0]).expect("serializa");
        assert_eq!(json["text_index"], 0);
        assert_eq!(json["line"], 0);
        assert_eq!(json["x"], 20.0);
        assert!(json["width"].as_f64().expect("número") > 0.0);
    }
}
