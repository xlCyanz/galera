//! Qué formato sale de una exportación y qué páginas salen en él.
//!
//! El trabajo de exportar lo hace [`crate::compile`]: de un [`Compiled`]
//! salen el PDF, el SVG y el PNG. Aquí está lo que va encima: **elegir
//! formato y páginas**, y saber qué archivos hay que escribir.
//!
//! # Los cuatro formatos
//!
//! - **PDF**, el documento entero en un archivo.
//! - **SVG**, uno por página. El texto va como trazado, así que se ve igual
//!   sin tener las fuentes.
//! - **PNG**, uno por página, con la densidad en puntos por pulgada.
//! - **`.typ`**, el código Typst que genera Galera, para seguir en Typst por
//!   su cuenta. Es el mismo que se compila, no una traducción aparte.
//!
//! # Qué páginas
//!
//! Todo, una sola o un rango ([`Pages`]). Las páginas se dicen **como se
//! ven**, contando desde 1, y salen resueltas a índices desde 0.
//!
//! Para el PDF y el `.typ`, pedir un rango no recorta un archivo hecho:
//! recorta **el documento**, con [`subset`], y lo que salga se compone de
//! ese documento. Así el `.typ` exportado de un rango compila tal cual, sin
//! páginas que no se pidieron.

use serde::{Deserialize, Serialize};

use crate::codegen;
use crate::compile::Compiled;
use crate::error::{GaleraError, Result};
use crate::model::Document;

/// A qué se exporta.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "format")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "export.ts"))]
pub enum Format {
    /// Un PDF con todas las páginas que se pidan.
    Pdf,
    /// Un SVG por página.
    Svg,
    /// Un PNG por página, con la densidad en puntos por pulgada.
    Png {
        /// Puntos por pulgada: 72 es el tamaño natural, 300 es imprenta.
        ppi: f32,
    },
    /// El código Typst generado.
    Typ,
}

impl Format {
    /// La extensión de los archivos que produce, sin el punto.
    pub fn extension(self) -> &'static str {
        match self {
            Format::Pdf => "pdf",
            Format::Svg => "svg",
            Format::Png { .. } => "png",
            Format::Typ => "typ",
        }
    }

    /// Si produce un archivo por página en vez de uno solo.
    pub fn is_per_page(self) -> bool {
        matches!(self, Format::Svg | Format::Png { .. })
    }
}

/// Qué páginas se exportan. Se cuentan desde 1, como se ven.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "pages")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "export.ts"))]
pub enum Pages {
    /// Todas.
    All,
    /// Una sola: la que se esté viendo, normalmente.
    Only {
        /// Cuál, contando desde 1.
        page: usize,
    },
    /// De la primera a la última, las dos incluidas. Si vienen al revés, se
    /// entienden al derecho: un rango no tiene sentido dado la vuelta.
    Range {
        /// La primera, contando desde 1.
        from: usize,
        /// La última, contando desde 1.
        to: usize,
    },
}

impl Pages {
    /// Los índices que salen, contando desde 0, en orden.
    ///
    /// # Errores
    ///
    /// [`GaleraError::PageOutOfRange`] si se pide una página que el
    /// documento no tiene. Un rango que se salga por el final no es un
    /// error: se queda en la última.
    pub fn resolve(self, count: usize) -> Result<Vec<usize>> {
        let out_of_range = |page: usize| GaleraError::PageOutOfRange {
            page: page.saturating_sub(1),
            count,
        };

        match self {
            Pages::All => Ok((0..count).collect()),
            Pages::Only { page } => {
                if page == 0 || page > count {
                    return Err(out_of_range(page));
                }
                Ok(vec![page - 1])
            }
            Pages::Range { from, to } => {
                let (first, last) = if from <= to { (from, to) } else { (to, from) };
                if first == 0 || first > count {
                    return Err(out_of_range(first));
                }
                // El final se queda en la última: pedir «de la 3 al final»
                // escribiendo un número grande es lo normal.
                Ok((first - 1..last.min(count)).collect())
            }
        }
    }
}

/// Un archivo de una exportación, ya en bytes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Exported {
    /// Qué página es, contando desde 1, si el formato va por páginas.
    pub page: Option<usize>,
    /// Los bytes del archivo.
    pub bytes: Vec<u8>,
}

/// El documento con solo las páginas que se digan, en el orden que se digan.
///
/// Lo demás —variables, fuentes, recursos— se queda como está: una página
/// suelta se compone con lo mismo que el documento entero.
pub fn subset(document: &Document, indexes: &[usize]) -> Document {
    let mut cut = document.clone();
    cut.pages = indexes
        .iter()
        .filter_map(|index| document.pages.get(*index).cloned())
        .collect();
    cut
}

/// El código Typst de un documento: lo que se exporta como `.typ`.
///
/// Es el mismo código que se compila, no una traducción aparte, así que lo
/// exportado compila con Typst tal cual.
///
/// # Errores
///
/// [`GaleraError::Codegen`] si el documento no se puede traducir.
pub fn typst_source(document: &Document) -> Result<String> {
    Ok(codegen::generate(document)?)
}

/// Los archivos de una exportación, de un documento ya compilado.
///
/// `indexes` son índices de páginas del [`Compiled`], contando desde 0. El
/// PDF y el `.typ` no se recortan aquí: lo que hay que recortar es el
/// documento antes de compilarlo (ver [`subset`]), y por eso salen enteros.
///
/// # Errores
///
/// Los de [`Compiled::to_svg`] y [`Compiled::to_png`].
pub fn export(compiled: &Compiled, format: Format, indexes: &[usize]) -> Result<Vec<Exported>> {
    match format {
        Format::Pdf => Ok(vec![Exported {
            page: None,
            bytes: compiled.to_pdf()?,
        }]),
        Format::Typ => Ok(vec![Exported {
            page: None,
            bytes: compiled.to_typ().as_bytes().to_vec(),
        }]),
        Format::Svg => indexes
            .iter()
            .map(|index| {
                Ok(Exported {
                    page: Some(index + 1),
                    bytes: compiled.to_svg(*index)?.into_bytes(),
                })
            })
            .collect(),
        Format::Png { ppi } => indexes
            .iter()
            .map(|index| {
                Ok(Exported {
                    page: Some(index + 1),
                    bytes: compiled.to_png(*index, ppi)?,
                })
            })
            .collect(),
    }
}

/// El nombre de un archivo exportado: el del documento y, si va por páginas,
/// con qué página es.
///
/// `stem` es el nombre sin extensión que haya elegido quien exporta.
pub fn file_name(stem: &str, format: Format, page: Option<usize>) -> String {
    let extension = format.extension();
    match page {
        Some(page) => format!("{stem}-{page}.{extension}"),
        None => format!("{stem}.{extension}"),
    }
}

#[cfg(test)]
mod tests {
    use std::path::Path;

    use typst_layout::PagedDocument;

    use super::*;
    use crate::compile::compile;
    use crate::project::Project;
    use crate::world::GaleraWorld;

    /// Un documento de dos páginas con texto en las dos.
    fn document() -> Document {
        Document::from_json_str(
            r##"{
              "version": 1,
              "meta": { "title": "Exportar" },
              "fonts": ["fonts/Inter-Regular.ttf", "fonts/Inter-Bold.ttf"],
              "pages": [
                {
                  "id": "p1",
                  "size": { "width": 210, "height": 297 },
                  "elements": [
                    { "id": "t1", "type": "text", "x": 20, "y": 20, "w": 100, "h": 20,
                      "content": [{ "text": "Primera" }],
                      "style": { "font": "Inter", "size": 14, "color": "#000000",
                                  "align": "left", "leading": 0.65 } }
                  ]
                },
                {
                  "id": "p2",
                  "size": { "width": 210, "height": 297 },
                  "elements": [
                    { "id": "t2", "type": "text", "x": 20, "y": 20, "w": 100, "h": 20,
                      "content": [{ "text": "Segunda" }],
                      "style": { "font": "Inter", "size": 14, "color": "#000000",
                                  "align": "left", "leading": 0.65 } }
                  ]
                }
              ]
            }"##,
        )
        .expect("es un documento")
    }

    fn project() -> Project {
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures");
        Project::open(&dir).expect("fixtures/ es un proyecto")
    }

    #[test]
    fn all_the_pages_or_one_or_a_range() {
        assert_eq!(Pages::All.resolve(3).expect("todas"), vec![0, 1, 2]);
        assert_eq!(
            Pages::Only { page: 2 }.resolve(3).expect("la segunda"),
            vec![1]
        );
        assert_eq!(
            Pages::Range { from: 2, to: 3 }
                .resolve(3)
                .expect("un rango"),
            vec![1, 2]
        );
        // Del revés se entiende al derecho.
        assert_eq!(
            Pages::Range { from: 3, to: 2 }
                .resolve(3)
                .expect("un rango"),
            vec![1, 2]
        );
        // Pasarse por el final se queda en la última.
        assert_eq!(
            Pages::Range { from: 2, to: 99 }
                .resolve(3)
                .expect("hasta el final"),
            vec![1, 2]
        );
    }

    #[test]
    fn a_page_that_is_not_there_says_so() {
        let error = Pages::Only { page: 4 }.resolve(3).expect_err("no está");
        assert_eq!(error.kind(), "page_out_of_range");
        assert_eq!(
            Pages::Only { page: 0 }
                .resolve(3)
                .expect_err("no hay página 0")
                .kind(),
            "page_out_of_range"
        );
        assert_eq!(
            Pages::Range { from: 9, to: 9 }
                .resolve(3)
                .expect_err("no está")
                .kind(),
            "page_out_of_range"
        );
    }

    /// El criterio de la tarea: se exporta SVG además del PDF.
    #[test]
    fn it_exports_one_svg_per_page() {
        let compiled = compile(&document(), &project()).expect("compila");
        let files = export(&compiled, Format::Svg, &[0, 1]).expect("se exporta");

        assert_eq!(files.len(), 2);
        assert_eq!(files[0].page, Some(1));
        assert_eq!(files[1].page, Some(2));
        let first = String::from_utf8(files[0].bytes.clone()).expect("es texto");
        assert!(
            first.starts_with("<svg"),
            "{}",
            &first[..40.min(first.len())]
        );
    }

    /// El criterio de la tarea: PNG con la densidad que se elija.
    #[test]
    fn it_exports_png_with_the_density_that_is_asked_for() {
        let compiled = compile(&document(), &project()).expect("compila");

        let small = export(&compiled, Format::Png { ppi: 72.0 }, &[0]).expect("se exporta");
        let big = export(&compiled, Format::Png { ppi: 144.0 }, &[0]).expect("se exporta");

        assert!(small[0].bytes.starts_with(b"\x89PNG"));
        // 210 mm a 72 ppp son 595 píxeles de ancho; al doble, 1191. El ancho
        // va en el cabecero IHDR, en los bytes 16..20.
        let width = |png: &[u8]| u32::from_be_bytes([png[16], png[17], png[18], png[19]]);
        assert_eq!(width(&small[0].bytes), 595);
        assert_eq!(width(&big[0].bytes), 1191);
    }

    #[test]
    fn a_density_that_does_not_make_sense_says_so() {
        let compiled = compile(&document(), &project()).expect("compila");
        let error = export(&compiled, Format::Png { ppi: 0.0 }, &[0]).expect_err("no vale");
        assert_eq!(error.kind(), "bad_density");
    }

    #[test]
    fn a_range_cuts_the_document_before_compiling_it() {
        let cut = subset(&document(), &[1]);
        assert_eq!(cut.pages.len(), 1);
        assert_eq!(cut.pages[0].id, "p2");

        let compiled = compile(&cut, &project()).expect("compila");
        assert_eq!(compiled.page_count(), 1);
    }

    /// El criterio de la tarea: el `.typ` exportado compila tal cual.
    ///
    /// Se compila con el compilador de Typst —el mismo crate `typst` 0.15.1
    /// que usa `typst compile`—, con el código exportado como fuente y sin
    /// pasar por `galera-core`: si lo exportado necesitara algo que solo
    /// pone Galera, aquí se vería.
    #[test]
    fn the_exported_typ_compiles_on_its_own() {
        let document = document();
        let code = typst_source(&document).expect("se genera");
        assert!(code.contains("Primera"));

        let world = GaleraWorld::new(project(), &document.fonts, code).expect("hay entorno");
        let compiled = typst::compile::<PagedDocument>(&world)
            .output
            .expect("el .typ exportado compila tal cual");

        assert_eq!(compiled.pages().len(), 2);
        assert!(world.main_source().text().contains("Segunda"));
    }

    /// El criterio de la tarea: también se exporta el `.typ`.
    #[test]
    fn the_typ_that_comes_out_is_the_code_that_was_compiled() {
        let document = document();
        let compiled = compile(&document, &project()).expect("compila");
        let files = export(&compiled, Format::Typ, &[]).expect("se exporta");

        assert_eq!(files.len(), 1);
        assert_eq!(files[0].page, None);
        let code = String::from_utf8(files[0].bytes.clone()).expect("es texto");
        assert_eq!(code, typst_source(&document).expect("se genera"));
    }

    #[test]
    fn the_names_say_which_page_they_are() {
        assert_eq!(file_name("informe", Format::Pdf, None), "informe.pdf");
        assert_eq!(file_name("informe", Format::Svg, Some(2)), "informe-2.svg");
        assert_eq!(
            file_name("informe", Format::Png { ppi: 300.0 }, Some(10)),
            "informe-10.png"
        );
        assert_eq!(file_name("informe", Format::Typ, None), "informe.typ");
    }
}
