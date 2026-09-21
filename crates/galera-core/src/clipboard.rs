//! Copiar y pegar elementos, también de un documento a otro.
//!
//! Lo que se copia no es una imagen ni un trozo de código Typst: son los
//! **elementos del modelo** tal como están, con lo que necesiten para poder
//! dibujarse en otro sitio. Un [`Clip`] lleva:
//!
//! - los elementos, con sus grupos y todo lo que va dentro;
//! - los **recursos** que usan sus imágenes, con el contenido del archivo,
//!   porque el documento donde se pegue puede no tenerlo;
//! - las **fuentes** que declara el documento de origen, por la misma razón.
//!
//! Así, pegar en otro proyecto no deja una imagen rota ni un texto compuesto
//! con otra tipografía (principio 4).
//!
//! # Al pegar
//!
//! - **Los ids se rehacen**: son únicos en el documento, y lo pegado no
//!   puede pisar lo que ya había. Se busca el primero libre a partir del
//!   suyo (`titulo` → `titulo-2`), también dentro de los grupos.
//! - **Se coloca donde se diga**: en el punto del cursor, o desplazado unos
//!   milímetros para que se vea que hay una copia encima.
//! - **Sale un solo comando** ([`Op::Batch`]), así que pegar cinco elementos
//!   con su recurso es un cambio del documento y un paso del historial.
//!
//! El archivo de un recurso o de una fuente no lo escribe el núcleo: sale
//! en el comando como una ruta, y quien lo aplique se encarga de dejarlo en
//! la carpeta del proyecto.

use std::collections::BTreeMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::assets::ASSETS_DIR;
use crate::fonts::FONTS_DIR;
use crate::import::copy_into;
use crate::model::{Document, Element, Page};
use crate::ops::{Op, OpError};
use crate::project::Project;

/// Cuánto se desplaza lo pegado cuando no se dice dónde, en mm.
pub const PASTE_OFFSET_MM: f64 = 5.0;

/// Un archivo que viaja con lo copiado.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClipFile {
    /// Su ruta dentro del proyecto de origen: `assets/logo.png`.
    pub path: String,
    /// Su contenido, si se pudo leer. Sin él, al pegar solo se declara la
    /// ruta y el archivo tendrá que estar ya ahí.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bytes: Option<Vec<u8>>,
}

/// Lo que se ha copiado.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Clip {
    /// Los elementos, en orden de capas.
    pub elements: Vec<Element>,
    /// Los recursos que usan sus imágenes, por su clave.
    #[serde(default)]
    pub assets: BTreeMap<String, ClipFile>,
    /// Las fuentes del documento de origen.
    #[serde(default)]
    pub fonts: Vec<ClipFile>,
}

impl Clip {
    /// Si no hay nada que pegar.
    pub fn is_empty(&self) -> bool {
        self.elements.is_empty()
    }
}

/// El elemento sin las zonas que lleve dentro, o `None` si él mismo es una.
fn without_zones(element: &Element) -> Option<Element> {
    match element {
        Element::Flow { .. } => None,
        Element::Group { base, children } => Some(Element::Group {
            base: base.clone(),
            children: children.iter().filter_map(without_zones).collect(),
        }),
        other => Some(other.clone()),
    }
}

/// Lo que hay que copiar de `document`: esos elementos, con las claves de
/// los recursos que usan y las fuentes declaradas.
///
/// Los archivos van vacíos: quien copia los rellena leyendo el proyecto
/// (ver [`ClipFile::bytes`]).
pub fn copy(document: &Document, ids: &[String]) -> Clip {
    // En el orden de la página, no en el que se seleccionaron: pegar
    // conserva las capas.
    //
    // Las zonas de un texto que fluye no se copian: una zona suelta no es
    // nada sin su flujo, y pegarla dejaría una cadena rota o un flujo
    // duplicado a medias. Copiar el flujo entero es tarea de F7-03.
    let elements: Vec<Element> = document
        .pages
        .iter()
        .flat_map(|page| &page.elements)
        .filter(|element| ids.iter().any(|id| id == element.id()))
        .filter_map(without_zones)
        .collect();

    let mut assets = BTreeMap::new();
    for element in elements.iter().flat_map(Element::tree) {
        if let Element::Image { asset, .. } = element
            && let Some(path) = document.assets.get(asset)
        {
            assets.insert(
                asset.clone(),
                ClipFile {
                    path: path.clone(),
                    bytes: None,
                },
            );
        }
    }

    let fonts = document
        .fonts
        .iter()
        .map(|path| ClipFile {
            path: path.clone(),
            bytes: None,
        })
        .collect();

    Clip {
        elements,
        assets,
        fonts,
    }
}

/// Lo copiado con el contenido de sus archivos, leídos del proyecto.
///
/// Lo que no se pueda leer se queda sin contenido: al pegar se declarará la
/// ruta, y si el proyecto de destino no tiene ese archivo, la validación lo
/// dirá como con cualquier recurso que falte.
pub fn with_files(project: &Project, clip: Clip) -> Clip {
    let read = |file: &ClipFile| ClipFile {
        path: file.path.clone(),
        bytes: project.read(&file.path).ok(),
    };
    Clip {
        assets: clip
            .assets
            .iter()
            .map(|(key, file)| (key.clone(), read(file)))
            .collect(),
        fonts: clip.fonts.iter().map(read).collect(),
        elements: clip.elements,
    }
}

/// Deja en el proyecto los archivos que trae lo copiado y devuelve lo
/// copiado con las rutas que les han tocado.
///
/// Si el proyecto ya tiene un archivo igual, se reutiliza; si tiene otro con
/// ese nombre, el nuevo entra al lado con un nombre libre. Lo que no traiga
/// contenido —o no se pueda escribir— se queda con la ruta que tenía.
pub fn materialize(project: &Project, clip: Clip) -> Clip {
    let place = |file: &ClipFile, dir: &str| ClipFile {
        path: match &file.bytes {
            Some(bytes) => copy_into(project, dir, Path::new(&file.path), bytes)
                .unwrap_or_else(|_| file.path.clone()),
            None => file.path.clone(),
        },
        bytes: None,
    };
    Clip {
        assets: clip
            .assets
            .iter()
            .map(|(key, file)| (key.clone(), place(file, ASSETS_DIR)))
            .collect(),
        fonts: clip
            .fonts
            .iter()
            .map(|file| place(file, FONTS_DIR))
            .collect(),
        elements: clip.elements,
    }
}

/// El texto de lo copiado, para pegarlo fuera de la aplicación.
///
/// Los bloques de texto, uno por línea y en orden; lo que no es texto no
/// aporta nada que leer.
pub fn plain_text(clip: &Clip) -> String {
    clip.elements
        .iter()
        .flat_map(Element::tree)
        .filter_map(|element| match element {
            Element::Text { content, .. } => Some(
                content
                    .iter()
                    .map(|run| run.text.as_str())
                    .collect::<String>(),
            ),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// El comando que pega lo copiado en la página `page`.
///
/// `at` es dónde va la esquina de lo pegado, en mm; sin él se desplaza
/// [`PASTE_OFFSET_MM`] de donde estaba.
///
/// # Errores
///
/// [`OpError::PageNotFound`] si no hay ninguna página con ese id.
pub fn paste(
    document: &Document,
    clip: &Clip,
    page: &str,
    at: Option<(f64, f64)>,
) -> Result<Op, OpError> {
    let target = document
        .pages
        .iter()
        .find(|one| one.id == page)
        .ok_or_else(|| OpError::PageNotFound {
            id: page.to_owned(),
        })?;
    if clip.is_empty() {
        return Ok(Op::Batch { ops: Vec::new() });
    }

    let mut ops = Vec::new();

    // Lo que falte en el documento: recursos y fuentes.
    let mut keys: BTreeMap<String, String> = BTreeMap::new();
    for (key, file) in &clip.assets {
        match document.assets.get(key) {
            // Ya lo tiene, con el mismo archivo: se usa el suyo.
            Some(path) if *path == file.path => {}
            // Lo tiene, pero es otro archivo: la copia entra con otra clave.
            Some(_) => {
                let free = free_id(key, &taken(document, &keys));
                keys.insert(key.clone(), free.clone());
                ops.push(Op::AddAsset {
                    key: free,
                    path: file.path.clone(),
                });
            }
            None => ops.push(Op::AddAsset {
                key: key.clone(),
                path: file.path.clone(),
            }),
        }
    }
    for font in &clip.fonts {
        if !document.fonts.contains(&font.path) {
            ops.push(Op::AddFont {
                path: font.path.clone(),
                index: None,
            });
        }
    }

    // Dónde se deja: en el punto que se diga, o desplazado.
    let (dx, dy) = match at {
        Some((x, y)) => {
            let (left, top) = corner(&clip.elements);
            (x - left, y - top)
        }
        None => (PASTE_OFFSET_MM, PASTE_OFFSET_MM),
    };

    let mut used = taken(document, &keys);
    for element in &clip.elements {
        let mut copy = element.clone();
        rename(&mut copy, &mut used);
        retarget(&mut copy, &keys);
        offset(&mut copy, dx, dy);
        ops.push(Op::Create {
            page: target.id.clone(),
            index: None,
            element: copy,
        });
    }

    Ok(Op::Batch { ops })
}

/// La esquina superior izquierda de lo copiado, en sus coordenadas.
fn corner(elements: &[Element]) -> (f64, f64) {
    elements
        .iter()
        .map(Element::position)
        .fold((f64::MAX, f64::MAX), |(left, top), (x, y)| {
            (left.min(x), top.min(y))
        })
}

/// Los ids que ya no se pueden usar: los del documento y los que se hayan
/// dado a los recursos de esta pegada.
fn taken(document: &Document, keys: &BTreeMap<String, String>) -> Vec<String> {
    let mut all: Vec<String> = document
        .pages
        .iter()
        .flat_map(|page: &Page| {
            std::iter::once(page.id.clone()).chain(
                page.elements
                    .iter()
                    .flat_map(Element::tree)
                    .map(|element| element.id().to_owned()),
            )
        })
        .collect();
    all.extend(document.assets.keys().cloned());
    all.extend(keys.values().cloned());
    all
}

/// Le da al elemento —y a lo que lleve dentro— un id libre.
fn rename(element: &mut Element, taken: &mut Vec<String>) {
    let id = free_id(element.id(), taken);
    taken.push(id.clone());
    element.set_id(id);
    if let Element::Group { children, .. } = element {
        for child in children {
            rename(child, taken);
        }
    }
}

/// Cambia las claves de los recursos que hayan tenido que cambiar.
fn retarget(element: &mut Element, keys: &BTreeMap<String, String>) {
    if keys.is_empty() {
        return;
    }
    match element {
        Element::Image { asset, .. } => {
            if let Some(key) = keys.get(asset) {
                asset.clone_from(key);
            }
        }
        Element::Group { children, .. } => {
            for child in children {
                retarget(child, keys);
            }
        }
        _ => {}
    }
}

/// Mueve un elemento `dx`, `dy` milímetros, sea del tipo que sea.
fn offset(element: &mut Element, dx: f64, dy: f64) {
    match element {
        Element::Line { x, y, x2, y2, .. } => {
            *x += dx;
            *y += dy;
            *x2 += dx;
            *y2 += dy;
        }
        other => {
            if let Some(base) = other.base_mut() {
                base.x += dx;
                base.y += dy;
            }
        }
    }
}

/// El primer id libre a partir de este: `titulo`, `titulo-2`, `titulo-3`…
fn free_id(id: &str, taken: &[String]) -> String {
    if !taken.iter().any(|one| one == id) {
        return id.to_owned();
    }
    // Si ya lleva un número al final, se cuenta desde su raíz.
    let root = match id.rsplit_once('-') {
        Some((root, tail)) if !root.is_empty() && tail.parse::<usize>().is_ok() => root,
        _ => id,
    };
    for number in 2.. {
        let candidate = format!("{root}-{number}");
        if !taken.iter().any(|one| one == &candidate) {
            return candidate;
        }
    }
    id.to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn document() -> Document {
        Document::from_json_str(
            r##"{
              "version": 1,
              "meta": { "title": "Portapapeles" },
              "fonts": ["fonts/Inter-Regular.ttf"],
              "assets": { "logo": "assets/logo.png" },
              "pages": [
                { "id": "p1", "size": { "width": 210, "height": 297 }, "elements": [
                  { "id": "r1", "type": "rect", "x": 10, "y": 20, "w": 30, "h": 40,
                    "fill": "#ff0000" },
                  { "id": "t1", "type": "text", "x": 20, "y": 100, "w": 80, "h": null,
                    "content": [{ "text": "Hola" }],
                    "style": { "font": "Inter", "size": 12, "color": "#000000" } },
                  { "id": "i1", "type": "image", "x": 50, "y": 50, "w": 40, "h": null,
                    "asset": "logo" }
                ] },
                { "id": "p2", "size": { "width": 210, "height": 297 }, "elements": [] }
              ]
            }"##,
        )
        .expect("es un documento")
    }

    /// Un documento vacío, como otro proyecto donde pegar.
    fn empty() -> Document {
        Document::from_json_str(
            r##"{
              "version": 1,
              "meta": { "title": "Otro" },
              "pages": [
                { "id": "hoja", "size": { "width": 210, "height": 297 }, "elements": [] }
              ]
            }"##,
        )
        .expect("es un documento")
    }

    fn ops(op: &Op) -> &[Op] {
        match op {
            Op::Batch { ops } => ops,
            other => panic!("no es un comando compuesto: {other:?}"),
        }
    }

    #[test]
    fn copying_takes_the_elements_in_the_order_of_the_page() {
        let clip = copy(&document(), &["i1".to_owned(), "r1".to_owned()]);
        assert_eq!(
            clip.elements.iter().map(Element::id).collect::<Vec<_>>(),
            vec!["r1", "i1"]
        );
    }

    /// El criterio de la tarea: lo copiado se lleva sus recursos y fuentes.
    #[test]
    fn copying_an_image_takes_its_asset_and_the_fonts() {
        let clip = copy(&document(), &["i1".to_owned()]);
        assert_eq!(
            clip.assets.get("logo").map(|file| file.path.as_str()),
            Some("assets/logo.png")
        );
        assert_eq!(
            clip.fonts
                .iter()
                .map(|file| file.path.as_str())
                .collect::<Vec<_>>(),
            vec!["fonts/Inter-Regular.ttf"]
        );
    }

    /// El criterio de la tarea: los ids se rehacen al pegar.
    #[test]
    fn pasting_in_the_same_document_gives_new_ids_and_moves_the_copy() {
        let document = document();
        let clip = copy(&document, &["r1".to_owned()]);
        let applied = paste(&document, &clip, "p1", None)
            .expect("se pega")
            .apply(&document)
            .expect("se aplica");

        assert!(
            applied.document.element("r1").is_some(),
            "el original sigue"
        );
        let copy = applied.document.element("r1-2").expect("la copia");
        assert_eq!(
            copy.position(),
            (10.0 + PASTE_OFFSET_MM, 20.0 + PASTE_OFFSET_MM)
        );
    }

    /// El criterio de la tarea: se puede pegar en el punto del cursor.
    #[test]
    fn pasting_at_a_point_puts_the_corner_there() {
        let document = document();
        let clip = copy(&document, &["r1".to_owned(), "i1".to_owned()]);
        let applied = paste(&document, &clip, "p2", Some((100.0, 200.0)))
            .expect("se pega")
            .apply(&document)
            .expect("se aplica");

        // La esquina de lo copiado estaba en (10, 20); r1 va al punto y la
        // imagen mantiene su distancia: (50-10, 50-20) más el punto.
        let rect = applied.document.element("r1-2").expect("está");
        assert_eq!(rect.position(), (100.0, 200.0));
        let image = applied.document.element("i1-2").expect("está");
        assert_eq!(image.position(), (140.0, 230.0));
        // Y en la página donde se pegó.
        assert_eq!(applied.document.pages[1].elements.len(), 2);
    }

    /// El criterio de la tarea: pegar en otro documento trae recurso y
    /// fuente.
    #[test]
    fn pasting_into_another_document_brings_the_asset_and_the_font() {
        let clip = copy(&document(), &["i1".to_owned()]);
        let other = empty();
        let applied = paste(&other, &clip, "hoja", None)
            .expect("se pega")
            .apply(&other)
            .expect("se aplica");

        assert_eq!(
            applied.document.assets.get("logo").map(String::as_str),
            Some("assets/logo.png")
        );
        assert_eq!(applied.document.fonts, vec!["fonts/Inter-Regular.ttf"]);
        assert!(
            applied.document.element("i1").is_some(),
            "el id estaba libre"
        );
    }

    /// Si la clave del recurso ya es de otro archivo, la copia entra con
    /// otra clave y su imagen la señala.
    #[test]
    fn an_asset_key_that_means_something_else_gets_another_one() {
        let clip = copy(&document(), &["i1".to_owned()]);
        let mut other = empty();
        other
            .assets
            .insert("logo".to_owned(), "assets/otro.png".to_owned());

        let applied = paste(&other, &clip, "hoja", None)
            .expect("se pega")
            .apply(&other)
            .expect("se aplica");

        assert_eq!(
            applied.document.assets.get("logo").map(String::as_str),
            Some("assets/otro.png"),
            "el de antes se queda"
        );
        assert_eq!(
            applied.document.assets.get("logo-2").map(String::as_str),
            Some("assets/logo.png")
        );
        let Element::Image { asset, .. } = applied.document.element("i1").expect("está") else {
            panic!("es una imagen");
        };
        assert_eq!(asset, "logo-2");
    }

    #[test]
    fn pasting_a_group_renames_what_is_inside_too() {
        let document = document();
        let grouped = Op::Group {
            ids: vec!["r1".to_owned(), "t1".to_owned()],
            id: "g1".to_owned(),
            rect: crate::layout::MmRect {
                x: 10.0,
                y: 20.0,
                w: 90.0,
                h: 120.0,
            },
        }
        .apply(&document)
        .expect("se agrupa")
        .document;

        let clip = copy(&grouped, &["g1".to_owned()]);
        let applied = paste(&grouped, &clip, "p1", None)
            .expect("se pega")
            .apply(&grouped)
            .expect("se aplica");

        assert!(applied.document.element("g1-2").is_some());
        assert!(
            applied.document.element("r1-2").is_some(),
            "el hijo también"
        );
    }

    #[test]
    fn the_plain_text_is_what_the_texts_say() {
        let clip = copy(&document(), &["r1".to_owned(), "t1".to_owned()]);
        assert_eq!(plain_text(&clip), "Hola");
        // Sin textos, no hay nada que pegar fuera.
        assert_eq!(plain_text(&copy(&document(), &["r1".to_owned()])), "");
    }

    #[test]
    fn pasting_nothing_changes_nothing() {
        let document = document();
        let clip = Clip {
            elements: Vec::new(),
            assets: BTreeMap::new(),
            fonts: Vec::new(),
        };
        assert!(ops(&paste(&document, &clip, "p1", None).expect("no falla")).is_empty());
    }

    #[test]
    fn pasting_into_a_page_that_is_not_there_says_so() {
        let document = document();
        let clip = copy(&document, &["r1".to_owned()]);
        let error = paste(&document, &clip, "fantasma", None).expect_err("no existe");
        assert!(matches!(error, OpError::PageNotFound { .. }));
    }
}
