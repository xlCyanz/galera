//! Lo que enseña el editor es lo que sale en el PDF.
//!
//! Es la prueba que protege el objetivo central del proyecto: el lienzo
//! dibuja el cursor y la selección con las posiciones de glifos que
//! devuelve el núcleo, y esas tienen que ser **las mismas** que Typst
//! escribe en el PDF exportado. Si se separan, el cursor se coloca donde no
//! es o el texto se parte en pantalla de una forma y en el papel de otra.
//!
//! # Cómo se comprueba
//!
//! Se lee el PDF **por fuera**, sin usar nada del código que se está
//! probando: se descomprimen sus flujos y se saca, de cada página, dónde
//! empieza cada línea de texto y cuántos glifos lleva. Typst escribe cada
//! línea como su propio bloque:
//!
//! ```text
//! q 1 0 0 -1 56.7 65.4 cm   ← la esquina izquierda de su línea base
//! BT /F1 12 Tf [<0123...>] TJ ET
//! Q
//! ```
//!
//! Del lado del editor, `Compiled::glyphs` da los glifos de cada bloque de
//! texto con su línea.
//!
//! Se comprueban tres cosas, con una tolerancia de una centésima de
//! milímetro:
//!
//! 1. **Cada línea del editor empieza donde el PDF empieza una.** Esto es
//!    el corte de línea: si Typst partiera el párrafo en otro sitio, la
//!    línea empezaría en otra parte.
//! 2. **Cada bloque de texto del PDF empieza en un glifo del editor.** Una
//!    línea puede salir en varios bloques —al cambiar de fuente a mitad,
//!    por ejemplo—, y cada uno tiene que caer en un glifo conocido.
//! 3. **Se dibujan tantos glifos como dice el editor**, página a página.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use galera_core::{Compiled, Document, Element, Glyph, Project, compile};

/// Lo que pueden diferir dos posiciones, en mm. Typst trabaja en puntos con
/// coma flotante y el PDF los escribe redondeados.
const TOLERANCE_MM: f64 = 0.01;

/// Puntos tipográficos por milímetro.
const PT_PER_MM: f64 = 72.0 / 25.4;

/// Dónde empieza una línea de texto y cuántos glifos lleva.
#[derive(Debug, Clone, Copy, PartialEq)]
struct LineStart {
    /// En mm desde el borde izquierdo de la página.
    x: f64,
    /// La línea base, en mm desde el borde de arriba.
    baseline: f64,
    /// Cuántos glifos se dibujan en esa línea.
    glyphs: usize,
}

impl LineStart {
    /// Si empiezan en el mismo sitio. No se comparan los glifos: una línea
    /// del editor puede salir en el PDF repartida en varios bloques.
    fn starts_like(&self, other: &Self) -> bool {
        (self.x - other.x).abs() < TOLERANCE_MM
            && (self.baseline - other.baseline).abs() < TOLERANCE_MM
    }
}

fn fixtures_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures")
}

fn load(name: &str) -> Document {
    let json = std::fs::read_to_string(fixtures_dir().join(format!("{name}.json")))
        .unwrap_or_else(|error| panic!("{name}.json: {error}"));
    Document::from_json_str(&json).expect("es un documento")
}

fn compiled(document: &Document) -> Compiled {
    let project = Project::open(&fixtures_dir()).expect("fixtures/ es un proyecto");
    compile(document, &project).expect("compila")
}

/// Los glifos que dibuja el editor, por página.
fn editor_glyphs(document: &Document, compiled: &Compiled) -> BTreeMap<usize, Vec<Glyph>> {
    let mut pages: BTreeMap<usize, Vec<Glyph>> = BTreeMap::new();
    for (page, content) in document.pages.iter().enumerate() {
        for element in &content.elements {
            if matches!(element, Element::Text { .. }) {
                pages
                    .entry(page)
                    .or_default()
                    .extend(compiled.glyphs(document, element.id()));
            }
        }
    }
    pages
}

/// Dónde empieza cada línea del editor, por página: el primer glifo de
/// cada línea de cada bloque de texto.
fn editor_lines(document: &Document, compiled: &Compiled) -> BTreeMap<usize, Vec<LineStart>> {
    let mut pages: BTreeMap<usize, Vec<LineStart>> = BTreeMap::new();

    for (page, content) in document.pages.iter().enumerate() {
        for element in &content.elements {
            if !matches!(element, Element::Text { .. }) {
                continue;
            }
            let glyphs = compiled.glyphs(document, element.id());
            let mut at = 0;
            while at < glyphs.len() {
                let line = glyphs[at].line;
                let count = glyphs[at..]
                    .iter()
                    .take_while(|one| one.line == line)
                    .count();
                pages.entry(page).or_default().push(LineStart {
                    x: glyphs[at].x,
                    baseline: glyphs[at].baseline,
                    glyphs: count,
                });
                at += count;
            }
        }
    }
    pages
}

/// Las líneas que hay en el PDF, por página, leídas del propio archivo.
fn pdf_lines(pdf: &[u8]) -> BTreeMap<usize, Vec<LineStart>> {
    let height = page_height(pdf);
    let mut pages = BTreeMap::new();

    for (page, content) in content_streams(pdf).into_iter().enumerate() {
        let mut lines = Vec::new();
        for block in content.split("\nQ") {
            if !block.contains("BT") {
                continue;
            }
            let Some((x, y)) = cm_translation(block) else {
                continue;
            };
            lines.push(LineStart {
                x: x / PT_PER_MM,
                baseline: (height - y) / PT_PER_MM,
                glyphs: glyphs_in(block),
            });
        }
        if !lines.is_empty() {
            pages.insert(page, lines);
        }
    }
    pages
}

/// Los flujos de contenido del PDF: los que llevan texto o dibujos, en el
/// orden en el que están, que es el de las páginas.
fn content_streams(pdf: &[u8]) -> Vec<String> {
    let mut streams = Vec::new();
    let mut rest = pdf;
    while let Some(start) = find(rest, b"stream\n") {
        let body = &rest[start + b"stream\n".len()..];
        let Some(end) = find(body, b"endstream") else {
            break;
        };
        let data = body[..end]
            .strip_suffix(b"\n")
            .map(|data| data.strip_suffix(b"\r").unwrap_or(data))
            .unwrap_or(&body[..end]);
        if let Ok(inflated) = miniz_oxide::inflate::decompress_to_vec_zlib(data) {
            let text = String::from_utf8_lossy(&inflated).into_owned();
            if text.contains("BT") {
                streams.push(text);
            }
        }
        rest = &body[end + b"endstream".len()..];
    }
    streams
}

/// La altura de la página, de su `/MediaBox`.
fn page_height(pdf: &[u8]) -> f64 {
    let start = find(pdf, b"/MediaBox[").expect("el PDF tiene MediaBox") + b"/MediaBox[".len();
    let end = start + find(&pdf[start..], b"]").expect("MediaBox cerrado");
    std::str::from_utf8(&pdf[start..end])
        .expect("MediaBox en ASCII")
        .split_whitespace()
        .nth(3)
        .expect("cuatro números")
        .parse()
        .expect("número")
}

/// La traslación de `q 1 0 0 -1 X Y cm` al principio de un bloque.
fn cm_translation(block: &str) -> Option<(f64, f64)> {
    let start = block.find("q 1 0 0 -1 ")? + "q 1 0 0 -1 ".len();
    let mut numbers = block[start..]
        .split_whitespace()
        .take(2)
        .map(|number| number.parse::<f64>().ok());
    Some((numbers.next()??, numbers.next()??))
}

/// Cuántos glifos dibuja un bloque de texto del PDF.
///
/// Typst escribe los glifos dentro de los arreglos de `TJ`, como cadenas
/// entre paréntesis y con dos bytes por glifo, porque la fuente va como
/// fuente compuesta. Entre una cadena y la siguiente van los ajustes de
/// espacio, que no son glifos.
///
/// Dentro de la cadena, una barra invertida escapa: `\(`, `\)`, `\\` y los
/// códigos en octal de hasta tres cifras. Cada escape es **un** byte.
fn glyphs_in(block: &str) -> usize {
    // Solo lo que va entre `BT` y `ET`: fuera de ahí hay otras cadenas que
    // no son texto dibujado, como el idioma de un tramo marcado.
    let Some(start) = block.find("BT") else {
        return 0;
    };
    let end = block[start..]
        .find("ET")
        .map_or(block.len(), |at| start + at);
    let block = &block[start..end];

    let mut bytes = 0;
    let mut characters = block.bytes().peekable();
    let mut inside = false;

    while let Some(character) = characters.next() {
        match character {
            b'(' if !inside => inside = true,
            b')' if inside => inside = false,
            b'\\' if inside => {
                bytes += 1;
                // Un código en octal se come hasta tres cifras; cualquier
                // otro escape, una sola.
                let mut digits = 0;
                while digits < 3
                    && characters
                        .peek()
                        .is_some_and(|next| next.is_ascii_digit() && *next < b'8')
                {
                    characters.next();
                    digits += 1;
                }
                if digits == 0 {
                    characters.next();
                }
            }
            _ if inside => bytes += 1,
            _ => {}
        }
    }
    bytes / 2
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

/// Comprueba que cada línea del editor empieza donde el PDF empieza un
/// bloque de texto.
fn assert_same_lines(name: &str) {
    let document = load(name);
    let compiled = compiled(&document);
    let pdf = compiled.to_pdf().expect("se exporta");

    let editor = editor_lines(&document, &compiled);
    let paper = pdf_lines(&pdf);
    assert!(!editor.is_empty(), "{name}: el documento dibuja texto");

    for (page, lines) in &editor {
        let there = paper
            .get(page)
            .unwrap_or_else(|| panic!("{name}: la página {page} no tiene texto en el PDF"));
        for line in lines {
            assert!(
                there.iter().any(|other| other.starts_like(line)),
                "{name}, página {page}: la línea del editor {line:?} no empieza en ninguna del PDF: {there:#?}"
            );
        }
    }
}

/// Comprueba que cada bloque del PDF cae en un glifo que el editor conoce,
/// y que se dibujan tantos glifos como dice.
///
/// Solo vale para documentos cuyo texto sea todo de bloques de texto sin
/// listas: un bloque de código también dibuja letras, y una lista añade sus
/// viñetas o sus números, que no están en el texto del documento.
fn assert_every_glyph_is_known(name: &str, same_count: bool) {
    let document = load(name);
    let compiled = compiled(&document);
    let pdf = compiled.to_pdf().expect("se exporta");

    let glyphs = editor_glyphs(&document, &compiled);
    let paper = pdf_lines(&pdf);

    for (page, blocks) in &paper {
        let known = glyphs
            .get(page)
            .unwrap_or_else(|| panic!("{name}: la página {page} dibuja texto sin glifos"));

        for block in blocks {
            assert!(
                known.iter().any(|glyph| {
                    (glyph.x - block.x).abs() < TOLERANCE_MM
                        && (glyph.baseline - block.baseline).abs() < TOLERANCE_MM
                }),
                "{name}, página {page}: el PDF dibuja en {block:?} y el editor no tiene glifo ahí"
            );
        }

        let drawn: usize = blocks.iter().map(|block| block.glyphs).sum();
        if same_count {
            assert_eq!(
                drawn,
                known.len(),
                "{name}, página {page}: el PDF dibuja {drawn} glifos y el editor dice {}",
                known.len()
            );
        } else {
            // Un carácter que ninguna fuente declarada cubre está en la
            // composición pero no llega a dibujarse: el editor sabe dónde
            // iría y el PDF no lo escribe.
            assert!(
                drawn <= known.len(),
                "{name}, página {page}: el PDF dibuja {drawn} glifos y el editor solo conoce {}",
                known.len()
            );
        }
    }
}

/// El criterio de la tarea: los cortes de línea y las posiciones del editor
/// son los del PDF. Con texto normal, justificado —donde Typst reparte los
/// espacios y parte las palabras—, tramos de estilos mezclados, listas
/// anidadas y varias páginas.
#[test]
fn the_lines_of_the_editor_are_the_lines_of_the_pdf() {
    for name in [
        "texto", "formato", "listas", "denso", "informe", "escape", "guionado",
    ] {
        assert_same_lines(name);
    }
}

/// El criterio de la tarea, por el otro lado: todo lo que el PDF dibuja lo
/// conoce el editor, y en la misma cantidad. Con tramos de estilos
/// mezclados, que Typst reparte en varios bloques dentro de una línea.
#[test]
fn every_glyph_in_the_pdf_is_one_the_editor_knows() {
    for name in ["texto", "formato", "denso", "guionado"] {
        assert_every_glyph_is_known(name, true);
    }

    // `escape.json` lleva a propósito emojis y japonés, que ninguna fuente
    // del proyecto cubre: de esos, el editor sabe dónde irían y el PDF no
    // llega a dibujarlos. Lo que sí tiene que cumplirse es que todo lo que
    // el PDF dibuja el editor lo conozca.
    assert_every_glyph_is_known("escape", false);
}

/// En una lista, lo único que el PDF dibuja y el editor no conoce son las
/// viñetas y los números, y van **a la izquierda** del primer glifo de su
/// línea, que es donde Typst los pone.
#[test]
fn the_only_thing_the_editor_does_not_know_in_a_list_is_the_marker() {
    let document = load("listas");
    let compiled = compiled(&document);
    let pdf = compiled.to_pdf().expect("se exporta");

    let glyphs = editor_glyphs(&document, &compiled);
    let mut markers = 0;

    for (page, blocks) in &pdf_lines(&pdf) {
        let known = &glyphs[page];
        for block in blocks {
            let known_here = known.iter().any(|glyph| {
                (glyph.x - block.x).abs() < TOLERANCE_MM
                    && (glyph.baseline - block.baseline).abs() < TOLERANCE_MM
            });
            if known_here {
                continue;
            }
            // Lo que no conoce es una marca: en la línea base de una línea
            // suya y antes de donde empieza su texto.
            let first = known
                .iter()
                .filter(|glyph| (glyph.baseline - block.baseline).abs() < TOLERANCE_MM)
                .map(|glyph| glyph.x)
                .fold(f64::INFINITY, f64::min);
            assert!(
                block.x < first,
                "página {page}: el PDF dibuja en {block:?}, que no es una marca de lista"
            );
            markers += 1;
        }
    }

    // El fixture tiene nueve elementos de lista —cinco con viñeta y cuatro
    // numerados—, cada uno con su marca.
    assert_eq!(markers, 9, "una marca por elemento de lista");
}

/// Un texto justificado y estrecho, que obliga a Typst a repartir los
/// espacios y a partir palabras: la prueba se mira de cerca este caso
/// porque es donde el editor y el papel se separarían primero.
#[test]
fn justified_and_hyphenated_text_breaks_the_same() {
    let document = load("denso");
    let compiled = compiled(&document);
    let pdf = compiled.to_pdf().expect("se exporta");

    let editor = editor_lines(&document, &compiled);
    let paper = pdf_lines(&pdf);

    // Hay varias líneas por página: si no, no se estaría comprobando nada.
    for (page, lines) in &editor {
        assert!(lines.len() > 5, "página {page}: {} líneas", lines.len());
        let there = &paper[page];
        assert_eq!(
            lines.len(),
            there.len(),
            "página {page}: el editor parte en {} líneas y el PDF en {}",
            lines.len(),
            there.len()
        );
        for (line, other) in lines.iter().zip(there) {
            assert!(
                line.starts_like(other) && line.glyphs == other.glyphs,
                "página {page}: {line:?} frente a {other:?}"
            );
        }
    }
}

/// El criterio de la tarea: también con guionado. `guionado.json` es una
/// columna estrecha y justificada en la que Typst parte palabras, y el
/// guion que añade **no está en el texto del documento**: es un glifo más,
/// que el editor tiene que conocer igual que el PDF.
#[test]
fn hyphenated_lines_match_too() {
    let document = load("guionado");
    let compiled = compiled(&document);
    let pdf = compiled.to_pdf().expect("se exporta");

    // Que de verdad haya guiones de partición: si un día dejara de
    // haberlos, esta prueba no estaría comprobando lo que dice.
    let glyphs = compiled.glyphs(&document, "columna");
    let hyphens = glyphs
        .windows(2)
        .filter(|pair| pair[0].text_index == pair[1].text_index)
        .count();
    assert!(
        hyphens >= 5,
        "la columna tiene que partir palabras: {hyphens}"
    );

    let editor = &editor_lines(&document, &compiled)[&0];
    let paper = &pdf_lines(&pdf)[&0];

    // Cada línea del editor empieza donde el PDF empieza un bloque.
    for line in editor {
        assert!(
            paper.iter().any(|other| other.starts_like(line)),
            "la línea {line:?} no empieza en ninguna del PDF"
        );
    }

    // El guion que añade Typst va en su propio bloque, porque no sale del
    // mismo sitio del código que la palabra que parte: por eso el PDF tiene
    // un bloque por línea **más uno por guion**.
    assert_eq!(
        paper.len(),
        editor.len() + hyphens,
        "{} líneas y {hyphens} guiones tendrían que dar {} bloques, y el PDF tiene {}",
        editor.len(),
        editor.len() + hyphens,
        paper.len()
    );

    // Y en total se dibujan los mismos glifos, guiones incluidos.
    let drawn: usize = paper.iter().map(|block| block.glyphs).sum();
    assert_eq!(
        drawn,
        glyphs.len(),
        "glifos dibujados frente a los del editor"
    );
}

/// La prueba tiene que fallar si algo se mueve: aquí se comprueba contra
/// el PDF de un documento parecido pero más estrecho, que parte las líneas
/// de otra forma.
#[test]
fn a_different_break_does_not_pass() {
    let document = load("denso");
    let mut narrower = document.clone();
    for page in &mut narrower.pages {
        for element in &mut page.elements {
            if let Some(base) = element.base_mut() {
                base.w -= 20.0;
            }
        }
    }

    let editor = editor_lines(&document, &compiled(&document));
    let paper = pdf_lines(&compiled(&narrower).to_pdf().expect("se exporta"));

    // La comparación estricta: dónde empieza cada línea y cuántos glifos
    // lleva, que es la que hace la prueba de verdad.
    let same = editor.iter().all(|(page, lines)| {
        paper.get(page).is_some_and(|there| {
            lines.len() == there.len()
                && lines
                    .iter()
                    .zip(there)
                    .all(|(line, other)| line.starts_like(other) && line.glyphs == other.glyphs)
        })
    });
    assert!(!same, "con otro ancho las líneas no pueden coincidir");
}
