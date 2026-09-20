//! Ayudas para las pruebas del núcleo: leer lo que Typst escribe en un PDF.

/// Los flujos del PDF que se pueden descomprimir, como texto.
pub(crate) fn pdf_streams(pdf: &[u8]) -> Vec<String> {
    let mut streams = Vec::new();
    let mut rest = pdf;
    while let Some(start) = find(rest, b"stream\n") {
        let body = &rest[start + b"stream\n".len()..];
        let Some(end) = find(body, b"endstream") else {
            break;
        };
        // Entre los datos y `endstream` va un salto de línea que no es
        // parte del flujo comprimido.
        let data = body[..end]
            .strip_suffix(b"\n")
            .map(|data| data.strip_suffix(b"\r").unwrap_or(data))
            .unwrap_or(&body[..end]);
        if let Ok(inflated) = miniz_oxide::inflate::decompress_to_vec_zlib(data) {
            streams.push(String::from_utf8_lossy(&inflated).into_owned());
        }
        // Saltar `endstream` entero: si no, su propio `stream\n` se
        // tomaría por el principio del siguiente flujo.
        rest = &body[end + b"endstream".len()..];
    }
    streams
}

/// La altura de la primera página, de su `/MediaBox`.
pub(crate) fn pdf_page_height(pdf: &[u8]) -> f64 {
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

pub(crate) fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

/// Puntos tipográficos por milímetro.
pub(crate) const PT_PER_MM: f64 = 72.0 / 25.4;

/// Dónde empieza cada línea de texto del PDF: la esquina izquierda de su
/// línea base, en puntos y con el origen arriba a la izquierda.
///
/// Typst escribe cada línea como `q 1 0 0 -1 X Y cm … BT … ET Q`, con el eje
/// y hacia arriba desde el pie de la página.
pub(crate) fn pdf_text_origins(pdf: &[u8]) -> Vec<(f64, f64)> {
    let page_height = pdf_page_height(pdf);
    let mut origins = Vec::new();
    for content in pdf_streams(pdf) {
        for block in content.split("\nQ") {
            if !block.contains("BT") {
                continue;
            }
            if let Some((x, y)) = cm_translation(block) {
                origins.push((x, page_height - y));
            }
        }
    }
    origins
}

/// Las cajas de los rectángulos rellenos del PDF, en puntos y con el origen
/// arriba a la izquierda. Solo rectángulos sin esquinas redondeadas.
///
/// Typst escribe un rectángulo como
/// `q 1 0 0 -1 X Y cm … 0 0 m W 0 l W H l 0 H l h f Q`.
pub(crate) fn pdf_filled_rects(pdf: &[u8]) -> Vec<(f64, f64, f64, f64)> {
    let page_height = pdf_page_height(pdf);
    let mut rects = Vec::new();
    for content in pdf_streams(pdf) {
        for block in content.split("\nQ") {
            if block.contains("BT") || !block.contains("\nf") || block.contains(" c\n") {
                continue;
            }
            let (Some((x, y)), Some(start)) = (cm_translation(block), block.find(" m ")) else {
                continue;
            };
            let points: Vec<f64> = block[start + 3..]
                .split_whitespace()
                .filter_map(|token| token.parse::<f64>().ok())
                .collect();
            let w = points.iter().step_by(2).cloned().fold(0.0, f64::max);
            let h = points
                .iter()
                .skip(1)
                .step_by(2)
                .cloned()
                .fold(0.0, f64::max);
            rects.push((x, page_height - y, w, h));
        }
    }
    rects
}

/// La traslación de `q 1 0 0 -1 X Y cm` al principio de un bloque.
fn cm_translation(block: &str) -> Option<(f64, f64)> {
    let start = block.find("q 1 0 0 -1 ")? + "q 1 0 0 -1 ".len();
    let mut numbers = block[start..]
        .split_whitespace()
        .take(2)
        .map(|n| n.parse::<f64>().ok());
    Some((numbers.next()??, numbers.next()??))
}

/// La carpeta `fixtures/` del repositorio, que es a la vez un proyecto.
pub(crate) fn fixtures_dir() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures")
}

/// `fixtures/` abierta como proyecto, con sus fuentes y sus imágenes.
pub(crate) fn project() -> crate::project::Project {
    crate::project::Project::open(&fixtures_dir()).expect("fixtures/ es un proyecto")
}

/// El documento `fixtures/NOMBRE.json`.
pub(crate) fn fixture(name: &str) -> crate::model::Document {
    let json = std::fs::read_to_string(fixtures_dir().join(format!("{name}.json")))
        .unwrap_or_else(|error| panic!("{name}.json: {error}"));
    crate::model::Document::from_json_str(&json).expect("es un documento")
}
