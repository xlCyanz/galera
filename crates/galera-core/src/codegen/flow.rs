//! El texto que fluye entre zonas.
//!
//! Un flujo es un texto y una cadena de zonas ([`crate::model::flow`]). Aquí
//! se escribe el código que hace que ese texto **pase de una zona a la
//! siguiente**, también a otra página.
//!
//! # Por qué no lo hace Typst solo
//!
//! Typst reparte el texto entre páginas, no entre rectángulos sueltos: no
//! hay nada nativo que enlace dos `place` para que el sobrante de uno siga
//! en el otro. Lo que sí hay es **su medidor**, que es el mismo que compone
//! la página.
//!
//! Así que el corte no lo calcula Galera: se buscan, con `measure`, cuántas
//! palabras caben en cada zona, y **quien dice si caben es Typst**, con la
//! fuente, el interlineado y la partición de líneas que vaya a usar al
//! dibujar. Galera solo hace la búsqueda; la medida no es suya (principio 3).
//!
//! ```text
//! piezas:  [Un ][texto ][que ][sigue ][y ][sigue…]
//!           └──── zona 1 ────┘└──── zona 2 ────┘└── sobra
//!                  mide Typst        mide Typst      → desbordado
//! ```
//!
//! # Lo que se emite
//!
//! Una vez por documento, la función que busca los cortes; una vez por
//! flujo, sus piezas, sus zonas y su estilo; y en cada zona, el trozo que le
//! toca más un `metadata` con **qué rango del texto quedó ahí**, que es lo
//! que lee [`crate::layout::flows`].
//!
//! Las piezas son palabras con su espacio: cortar más fino no serviría
//! —Typst no parte una palabra— y cortar más grueso dejaría zonas a medio
//! llenar. Cada pieza lleva cuántos caracteres del texto del modelo ocupa,
//! para que el rango que sale sea del texto que se escribe, no del que se
//! compone.

use std::fmt::Write as _;

use crate::model::{Align, Document, ElementBox, Flow, Run, TextStyle};

use super::{CodegenError, color, millimeters, number, text::emit_run, text::points};

/// La función que busca los cortes, una vez por documento.
///
/// Recibe las piezas, las zonas y el estilo del flujo, y devuelve por cada
/// zona el rango de piezas que le toca. Se llama dentro de un `context`
/// porque `measure` solo existe ahí.
///
/// La búsqueda es binaria sobre el número de piezas: como mucho una zona
/// mide `log2(piezas)` veces, y Typst memoiza cada medida.
const RANGES_FUNCTION: &str = r#"#let galera-flow-ranges(pieces, zones, style, upto) = {
  let ranges = ()
  let at = 0
  // Cuántas piezas se llevó la zona anterior: dos zonas parecidas se
  // llevan parecido, y empezar por ahí ahorra casi todas las medidas.
  let guess = 1
  let index = 0

  for zone in zones {
    if index > upto { break }
    index = index + 1

    if at >= pieces.len() {
      ranges.push((at, at))
    } else if zone.h == none {
      // Sin alto, la zona es tan alta como haga falta: se lleva el resto.
      ranges.push((at, pieces.len()))
      at = pieces.len()
    } else {
      let fits = (k) => measure(block(
        width: zone.w,
        style(pieces.slice(at, k).map(p => p.body).join()),
      )).height <= zone.h

      let low = at
      let high = none
      let first = calc.min(at + calc.max(guess, 1), pieces.len())

      if fits(first) {
        low = first
        if first == pieces.len() {
          high = first
        } else {
          // Cabe más: se prueba de más en más, doblando.
          let step = calc.max(1, calc.floor(guess / 4))
          while high == none {
            let next = calc.min(low + step, pieces.len())
            if fits(next) {
              low = next
              if next == pieces.len() { high = next } else { step = step * 2 }
            } else {
              high = next
            }
          }
        }
      } else {
        // No cabe tanto: el corte está entre lo que hay y el tanteo.
        high = first
      }

      // Y entre lo último que cabe y lo primero que no, binaria.
      while low + 1 < high {
        let mid = calc.floor((low + high) / 2)
        if fits(mid) { low = mid } else { high = mid }
      }

      ranges.push((at, low))
      guess = calc.max(low - at, 1)
      at = low
    }
  }

  ranges
}
"#;

/// Escribe lo que necesitan los flujos del documento, antes de las páginas.
///
/// Si no hay flujos no escribe nada: un documento sin texto que fluya sale
/// exactamente igual que antes.
///
/// # Errores
///
/// Los de escribir un tramo de texto: un color o un enlace que no valen.
pub(super) fn emit_prelude(document: &Document, out: &mut String) -> Result<(), CodegenError> {
    if document.flows.is_empty() {
        return Ok(());
    }

    out.push_str(RANGES_FUNCTION);

    for (index, flow) in document.flows.values().enumerate() {
        emit_style(index, &flow.style, out)?;
        emit_pieces(index, flow, document, out)?;
        emit_zones(index, flow, document, out);
    }

    Ok(())
}

/// El estilo del flujo, como una función que envuelve al contenido.
///
/// Va en una función para que **medir y dibujar usen lo mismo**: si la
/// medida no llevara el estilo, el corte saldría de un texto que no es el
/// que se ve.
fn emit_style(index: usize, style: &TextStyle, out: &mut String) -> Result<(), CodegenError> {
    let _ = write!(
        out,
        "#let galera-flow-{index}-style = (body) => {{ set text(font: {}, size: {}, fill: {}); set par(leading: {}em",
        super::typst_string(&style.font),
        points(style.size),
        color(&style.color)?,
        number(style.leading),
    );

    if let Some(spacing) = style.spacing {
        let _ = write!(out, ", spacing: {}em", number(spacing));
    }
    if style.align == Align::Justify {
        out.push_str(", justify: true");
    }

    let _ = writeln!(
        out,
        "); align({})[#body] }}",
        super::text::horizontal_alignment(style.align)
    );
    Ok(())
}

/// Las piezas del texto: palabra y espacio, con cuántos caracteres del
/// modelo ocupa cada una.
fn emit_pieces(
    index: usize,
    flow: &Flow,
    document: &Document,
    out: &mut String,
) -> Result<(), CodegenError> {
    let _ = write!(out, "#let galera-flow-{index}-pieces = (");

    for run in &flow.content {
        for piece in split(&run.text) {
            let _ = write!(out, "(len: {}, body: [", piece.text.len());
            emit_piece(&piece, run, document, out)?;
            out.push_str("]), ");
        }
    }

    out.push_str(")\n");
    Ok(())
}

/// Las zonas del flujo, con el tamaño que declara cada una.
///
/// Una zona que no está —una cadena a medio arreglar— se escribe igual, con
/// tamaño cero: así el flujo sigue teniendo tantas zonas como su cadena y
/// los índices no se mueven.
fn emit_zones(index: usize, flow: &Flow, document: &Document, out: &mut String) {
    let _ = write!(out, "#let galera-flow-{index}-zones = (");

    for id in &flow.zones {
        let base = document.elements().find_map(|element| match element {
            crate::model::Element::Flow { base, .. } if base.id == *id => Some(base),
            _ => None,
        });

        match base {
            Some(base) => {
                let _ = write!(out, "(w: {}, h: ", millimeters(base.w));
                match base.h {
                    Some(height) => {
                        let _ = write!(out, "{}", millimeters(height));
                    }
                    None => out.push_str("none"),
                }
                out.push_str("), ");
            }
            None => out.push_str("(w: 0mm, h: 0mm), "),
        }
    }

    out.push_str(")\n");
}

/// Escribe una zona: el trozo que le toca y el rango que ocupa.
///
/// `flow` es el nombre del flujo al que pertenece. Una zona de un flujo que
/// no existe, o que su cadena no lleva, se compone vacía: el documento no
/// vale (lo dice la validación), pero componerlo no puede romperse.
pub(super) fn emit_zone(base: &ElementBox, flow: &str, document: &Document, out: &mut String) {
    let place = document
        .flows
        .iter()
        .enumerate()
        .find(|(_, (name, _))| name.as_str() == flow)
        .and_then(|(index, (_, one))| one.position_of(&base.id).map(|zone| (index, zone)));

    let _ = write!(out, "#block(width: {}", millimeters(base.w));
    if let Some(height) = base.h {
        let _ = write!(out, ", height: {}", millimeters(height));
    }

    let Some((index, zone)) = place else {
        out.push(')');
        return;
    };

    // El `metadata` va dentro de la zona: así el layout sabe de quién es el
    // rango sin buscarlo por orden (ver `crate::layout::flows`).
    let _ = write!(
        out,
        ", context {{ \
         let pieces = galera-flow-{index}-pieces; \
         let range = galera-flow-ranges(pieces, galera-flow-{index}-zones, galera-flow-{index}-style, {zone}).at({zone}); \
         let before = pieces.slice(0, range.at(0)).fold(0, (sum, piece) => sum + piece.len); \
         let here = pieces.slice(range.at(0), range.at(1)).fold(0, (sum, piece) => sum + piece.len); \
         metadata((from: before, to: before + here)); \
         galera-flow-{index}-style(pieces.slice(range.at(0), range.at(1)).map(piece => piece.body).join()) \
         }})"
    );
}

/// Cuántos bytes tiene el texto de un flujo, para saber si sobra algo
/// después de la última zona.
///
/// En bytes y no en caracteres porque así se cuenta el texto en todo el
/// núcleo: es lo que usan la selección y los comandos de edición.
pub fn length(flow: &Flow) -> usize {
    flow.content.iter().map(|run| run.text.len()).sum()
}

/// Una pieza del texto del flujo, con su sitio en el texto del modelo.
///
/// La usa [`crate::layout::glyphs`] para traducir un glifo a su posición en
/// el texto: el código de una pieza está en el arreglo del preámbulo, no en
/// el sitio donde se dibuja.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PieceSpan {
    /// Dónde empieza en el texto del flujo, en bytes.
    pub start: usize,
    /// Lo que ocupa: la palabra y el espacio que la sigue.
    pub text: String,
    /// Dónde acaba la palabra dentro de `text`: lo que va detrás es el
    /// espacio, que el código escribe como espacio o como salto.
    pub word: usize,
}

/// Las piezas del texto de un flujo, en el mismo orden en que se emiten.
pub(crate) fn piece_spans(flow: &Flow) -> Vec<PieceSpan> {
    let mut spans = Vec::new();
    let mut at = 0;

    for run in &flow.content {
        for piece in split(&run.text) {
            spans.push(PieceSpan {
                start: at,
                text: piece.text.to_owned(),
                word: piece.word.len(),
            });
            at += piece.text.len();
        }
    }

    spans
}

/// Una pieza del texto: una palabra con el espacio que la sigue.
struct Piece<'a> {
    /// Lo que ocupa del texto del modelo, palabra y espacio.
    text: &'a str,
    /// La palabra, ya sin el espacio.
    word: &'a str,
    /// Qué separa esta pieza de la siguiente.
    break_: Break,
}

/// Qué hay entre una pieza y la siguiente.
#[derive(PartialEq)]
enum Break {
    /// Nada: la pieza acaba el texto.
    None,
    /// Un espacio.
    Space,
    /// Un salto de línea dentro del mismo párrafo.
    Line,
    /// Un párrafo nuevo.
    Paragraph,
}

/// Parte el texto en piezas de palabra y espacio.
///
/// Se parte por palabras porque es donde Typst puede cortar una línea:
/// partir más fino daría cortes que Typst no haría, y más grueso dejaría
/// zonas a medio llenar.
fn split(text: &str) -> Vec<Piece<'_>> {
    let mut pieces = Vec::new();
    let mut at = 0;

    while at < text.len() {
        let rest = &text[at..];
        let word_end = rest.find(char::is_whitespace).unwrap_or(rest.len());
        let space_end = rest[word_end..]
            .find(|c: char| !c.is_whitespace())
            .map_or(rest.len(), |end| word_end + end);

        let space = &rest[word_end..space_end];
        let break_ = match space.matches('\n').count() {
            0 if space.is_empty() => Break::None,
            0 => Break::Space,
            1 => Break::Line,
            _ => Break::Paragraph,
        };

        pieces.push(Piece {
            text: &rest[..space_end],
            word: &rest[..word_end],
            break_,
        });
        at += space_end;
    }

    pieces
}

/// Escribe una pieza: su palabra con el formato de su tramo, y lo que la
/// separa de la siguiente.
fn emit_piece(
    piece: &Piece<'_>,
    run: &Run,
    document: &Document,
    out: &mut String,
) -> Result<(), CodegenError> {
    if !piece.word.is_empty() {
        emit_run(piece.word, run, &document.variables, out)?;
    }

    match piece.break_ {
        Break::None => {}
        Break::Space => out.push(' '),
        Break::Line => out.push_str("#linebreak()"),
        Break::Paragraph => out.push_str("#parbreak()"),
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::codegen::generate;
    use crate::model::Document;

    fn document() -> Document {
        Document::from_json_str(
            r##"{
              "version": 1,
              "meta": { "title": "Flujo" },
              "flows": {
                "cuerpo": {
                  "content": [{ "text": "Un texto largo que sigue" }],
                  "style": { "font": "Inter", "size": 11, "color": "#000000" },
                  "zones": ["z1", "z2"]
                }
              },
              "pages": [
                { "id": "p1", "size": { "width": 210, "height": 297 },
                  "elements": [
                    { "id": "z1", "type": "flow", "x": 20, "y": 20, "w": 80, "h": 100,
                      "flow": "cuerpo" }
                  ] },
                { "id": "p2", "size": { "width": 210, "height": 297 },
                  "elements": [
                    { "id": "z2", "type": "flow", "x": 20, "y": 20, "w": 80, "h": null,
                      "flow": "cuerpo" }
                  ] }
              ]
            }"##,
        )
        .expect("es un documento")
    }

    #[test]
    fn the_pieces_are_words_with_their_space() {
        let code = generate(&document()).expect("se genera");
        assert!(code.contains("(len: 3, body: [Un ])"), "{code}");
        assert!(code.contains("(len: 5, body: [sigue])"), "{code}");
    }

    #[test]
    fn each_zone_takes_its_range_and_says_which_one_it_is() {
        let code = generate(&document()).expect("se genera");
        assert!(code.contains("galera-flow-0-zones"), "{code}");
        assert!(code.contains(").at(0);"), "{code}");
        assert!(code.contains(").at(1);"), "{code}");
        assert!(
            code.contains("metadata((from: before, to: before + here))"),
            "{code}"
        );
    }

    /// Que el código salga bien no basta: tiene que compilar.
    #[test]
    fn it_compiles_and_splits_the_text_between_the_zones() {
        let mut document = document();
        document.fonts = vec![
            "fonts/Inter-Regular.ttf".to_owned(),
            "fonts/Inter-Bold.ttf".to_owned(),
        ];
        document.flows.get_mut("cuerpo").expect("está").content =
            vec![crate::model::Run::plain("palabra ".repeat(200))];

        let project = crate::Project::open(
            &std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures"),
        )
        .expect("fixtures/ es un proyecto");
        let compiled = crate::compile(&document, &project).expect("compila");
        assert_eq!(compiled.page_count(), 2);
    }

    #[test]
    fn a_document_without_flows_is_written_exactly_as_before() {
        let mut without = document();
        without.flows.clear();
        without.pages[0].elements.clear();
        without.pages[1].elements.clear();

        let code = generate(&without).expect("se genera");
        assert!(!code.contains("galera-flow"), "{code}");
    }
}
