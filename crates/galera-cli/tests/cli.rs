//! Pruebas de `galera-cli` de extremo a extremo: se ejecuta el binario de
//! verdad, como lo ejecutaría una persona desde la terminal.

use std::fs;
use std::path::Path;
use std::process::{Command, Output};

use tempfile::TempDir;

/// Ejecuta `galera-cli` con los argumentos dados, desde `dir`.
fn galera(dir: &Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_galera-cli"))
        .current_dir(dir)
        .args(args)
        .output()
        .expect("el binario debe poder ejecutarse")
}

fn stderr(output: &Output) -> String {
    String::from_utf8_lossy(&output.stderr).into_owned()
}

fn stdout(output: &Output) -> String {
    String::from_utf8_lossy(&output.stdout).into_owned()
}

/// Un proyecto de dos páginas con fuente e imagen, en una carpeta temporal.
///
/// Usa Libertinus Serif, que viene en `typst-assets`, para no depender de
/// fuentes que el repositorio no incluye.
fn project() -> TempDir {
    let dir = TempDir::new().expect("carpeta temporal");

    fs::create_dir(dir.path().join("fonts")).expect("fonts/");
    fs::write(
        dir.path().join("fonts/LibertinusSerif-Regular.otf"),
        typst_assets::fonts().next().expect("fuente de prueba"),
    )
    .expect("escribir la fuente");

    fs::create_dir(dir.path().join("assets")).expect("assets/");
    fs::copy(
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/assets/pixel.png"),
        dir.path().join("assets/logo.png"),
    )
    .expect("copiar la imagen");

    fs::write(
        dir.path().join("document.json"),
        r##"{
          "version": 1,
          "meta": { "title": "Informe de prueba" },
          "fonts": ["fonts/LibertinusSerif-Regular.otf"],
          "assets": { "logo": "assets/logo.png" },
          "pages": [
            { "id": "p1", "size": { "width": 210, "height": 297, "unit": "mm" },
              "elements": [
                { "id": "r1", "type": "rect", "x": 0, "y": 0, "w": 210, "h": 15,
                  "fill": "#1e40af", "stroke": null },
                { "id": "t1", "type": "text", "x": 20, "y": 30, "w": 170, "h": null,
                  "content": [{ "text": "Informe anual" }],
                  "style": { "font": "Libertinus Serif", "size": 28, "color": "#1F2733" } },
                { "id": "i1", "type": "image", "x": 20, "y": 60, "w": 80, "h": null, "asset": "logo" }
              ] },
            { "id": "p2", "size": { "width": 148, "height": 210, "unit": "mm" } }
          ]
        }"##,
    )
    .expect("escribir el documento");

    dir
}

// ── Salidas ─────────────────────────────────────────────────────────────

/// El criterio de la tarea: `galera-cli <entrada.json> -o <salida.pdf>`.
#[test]
fn it_writes_a_pdf() {
    let dir = project();
    let output = galera(dir.path(), &["document.json", "-o", "salida.pdf"]);

    assert!(output.status.success(), "{}", stderr(&output));
    let pdf = fs::read(dir.path().join("salida.pdf")).expect("el PDF debe existir");
    assert!(pdf.starts_with(b"%PDF-"));
    assert!(stderr(&output).contains("2 páginas"), "{}", stderr(&output));
}

#[test]
fn a_project_folder_works_as_input() {
    let dir = project();
    let output = galera(dir.path(), &[".", "-o", "salida.pdf"]);
    assert!(output.status.success(), "{}", stderr(&output));
    assert!(dir.path().join("salida.pdf").exists());
}

/// Desde fuera de la carpeta del proyecto, las fuentes y las imágenes se
/// siguen buscando junto al documento, no en la carpeta actual.
#[test]
fn assets_are_found_next_to_the_document_not_in_the_current_folder() {
    let dir = project();
    let elsewhere = TempDir::new().expect("carpeta temporal");
    let input = dir.path().join("document.json");

    let output = galera(
        elsewhere.path(),
        &[input.to_str().expect("ruta UTF-8"), "-o", "salida.pdf"],
    );
    assert!(output.status.success(), "{}", stderr(&output));
    assert!(elsewhere.path().join("salida.pdf").exists());
}

/// El criterio de la tarea: `--format svg` y `--page N`.
#[test]
fn it_writes_an_svg_of_the_requested_page() {
    let dir = project();
    let output = galera(
        dir.path(),
        &[
            "document.json",
            "-o",
            "pagina",
            "--format",
            "svg",
            "--page",
            "2",
        ],
    );

    assert!(output.status.success(), "{}", stderr(&output));
    let svg = fs::read_to_string(dir.path().join("pagina")).expect("el SVG debe existir");
    assert!(svg.starts_with("<svg"), "{svg}");
    // La página 2 es A5: 148 mm son 419,53 pt.
    assert!(svg.contains(r#"width="419.527559055pt""#), "{svg}");
}

#[test]
fn the_format_is_inferred_from_the_output_extension() {
    let dir = project();
    let output = galera(dir.path(), &["document.json", "-o", "portada.svg"]);

    assert!(output.status.success(), "{}", stderr(&output));
    let svg = fs::read_to_string(dir.path().join("portada.svg")).expect("el SVG debe existir");
    assert!(svg.starts_with("<svg"));
    assert!(stderr(&output).contains("página 1"), "{}", stderr(&output));
}

#[test]
fn page_is_ignored_with_a_warning_for_pdf() {
    let dir = project();
    let output = galera(
        dir.path(),
        &["document.json", "-o", "salida.pdf", "--page", "2"],
    );
    assert!(output.status.success(), "{}", stderr(&output));
    assert!(
        stderr(&output).contains("--page se ignora"),
        "{}",
        stderr(&output)
    );
}

/// El criterio de la tarea: `--emit-typst`, sin archivo, a la salida
/// estándar.
#[test]
fn emit_typst_prints_the_generated_code() {
    let dir = project();
    let output = galera(dir.path(), &["document.json", "--emit-typst"]);

    assert!(output.status.success(), "{}", stderr(&output));
    let code = stdout(&output);
    assert!(
        code.contains(r#"#set document(title: "Informe de prueba")"#),
        "{code}"
    );
    assert!(
        code.contains("#set page(width: 210mm, height: 297mm, margin: 0pt)"),
        "{code}"
    );
    assert!(code.contains("<el-t1>"), "{code}");
}

#[test]
fn emit_typst_writes_to_a_file_when_given_one() {
    let dir = project();
    let output = galera(
        dir.path(),
        &["document.json", "--emit-typst", "-o", "main.typ"],
    );

    assert!(output.status.success(), "{}", stderr(&output));
    assert!(stdout(&output).is_empty());
    let code = fs::read_to_string(dir.path().join("main.typ")).expect("main.typ debe existir");
    assert!(code.contains("<el-r1>"));
}

/// El criterio de salida de la Fase 0, tal como lo escribe `guide.md`:
/// `galera-cli fixtures/informe.json -o salida.pdf` genera un PDF correcto.
#[test]
fn the_guide_example_compiles_from_the_fixtures_folder() {
    let repository = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let out = TempDir::new().expect("carpeta temporal");
    let pdf_path = out.path().join("salida.pdf");

    let output = galera(
        &repository,
        &[
            "fixtures/informe.json",
            "-o",
            pdf_path.to_str().expect("ruta UTF-8"),
        ],
    );

    assert!(output.status.success(), "{}", stderr(&output));
    assert!(
        !stderr(&output).contains("aviso"),
        "sin avisos: {}",
        stderr(&output)
    );
    let pdf = fs::read(&pdf_path).expect("el PDF debe existir");
    assert!(pdf.starts_with(b"%PDF-"));
    assert!(
        pdf.windows(b"Inter-Regular".len())
            .any(|window| window == b"Inter-Regular"),
        "con Inter incrustada"
    );
}

// ── Errores ─────────────────────────────────────────────────────────────

/// El criterio de la tarea: los errores salen por stderr con contexto y un
/// código de salida distinto de cero. Estos son los errores de uso, que
/// resuelve `clap`.
#[test]
fn usage_errors_exit_non_zero() {
    let dir = project();
    for args in [
        vec![],
        vec!["document.json", "--page", "0"],
        vec!["document.json", "--format", "png"],
        vec!["document.json", "--emit-typst", "--format", "svg"],
    ] {
        let output = galera(dir.path(), &args);
        assert!(!output.status.success(), "{args:?} debería fallar");
        assert!(
            !stderr(&output).is_empty(),
            "{args:?} debería explicar por qué"
        );
    }
}

#[test]
fn a_missing_input_names_the_file() {
    let dir = project();
    let output = galera(dir.path(), &["no-existe.json", "-o", "salida.pdf"]);

    assert!(!output.status.success());
    let message = stderr(&output);
    assert!(message.starts_with("error: "), "{message}");
    assert!(message.contains("no-existe.json"), "{message}");
}

#[test]
fn invalid_json_names_the_file() {
    let dir = project();
    fs::write(dir.path().join("roto.json"), "{ esto no es json").expect("escribir");
    let output = galera(dir.path(), &["roto.json", "-o", "salida.pdf"]);

    assert!(!output.status.success());
    let message = stderr(&output);
    assert!(
        message.contains("roto.json no es un documento válido"),
        "{message}"
    );
}

#[test]
fn a_missing_output_is_explained() {
    let dir = project();
    let output = galera(dir.path(), &["document.json"]);

    assert!(!output.status.success());
    assert!(
        stderr(&output).contains("-o salida.pdf"),
        "{}",
        stderr(&output)
    );
}

#[test]
fn a_typst_error_is_reported_with_its_message() {
    let dir = project();
    fs::write(
        dir.path().join("roto.json"),
        r##"{
          "version": 1,
          "meta": { "title": "Roto" },
          "pages": [{ "id": "p1", "size": { "width": 210, "height": 297, "unit": "mm" },
            "elements": [{ "id": "c1", "type": "code", "x": 0, "y": 0, "w": 50, "h": null,
                           "source": "#table(columns: 2)[A" }] }]
        }"##,
    )
    .expect("escribir");

    let output = galera(dir.path(), &["roto.json", "-o", "salida.pdf"]);
    assert!(!output.status.success());
    let message = stderr(&output);
    assert!(
        message.contains("no se pudo compilar roto.json"),
        "{message}"
    );
    assert!(message.contains("unclosed delimiter"), "{message}");
    assert!(
        !dir.path().join("salida.pdf").exists(),
        "no se escribe nada si falla"
    );
}

#[test]
fn a_page_that_does_not_exist_is_counted_from_one() {
    let dir = project();
    let output = galera(dir.path(), &["document.json", "-o", "x.svg", "--page", "3"]);

    assert!(!output.status.success());
    assert!(
        stderr(&output).contains("no existe la página 3"),
        "{}",
        stderr(&output)
    );
}

#[test]
fn a_galera_file_is_not_supported_yet() {
    let dir = project();
    fs::write(dir.path().join("informe.galera"), b"").expect("escribir");
    let output = galera(dir.path(), &["informe.galera", "-o", "salida.pdf"]);

    assert!(!output.status.success());
    assert!(stderr(&output).contains("F3-11"), "{}", stderr(&output));
}

/// Una fuente desconocida no es un error para Typst, pero tiene que verse.
#[test]
fn warnings_are_printed() {
    let dir = project();
    let json = fs::read_to_string(dir.path().join("document.json"))
        .expect("leer")
        .replace(r#""font": "Libertinus Serif""#, r#""font": "Inter""#);
    fs::write(dir.path().join("otra.json"), json).expect("escribir");

    let output = galera(dir.path(), &["otra.json", "-o", "salida.pdf"]);
    assert!(output.status.success(), "{}", stderr(&output));
    assert!(
        stderr(&output)
            .to_lowercase()
            .contains("aviso: unknown font family: inter"),
        "{}",
        stderr(&output)
    );
}

// ── Ayuda ───────────────────────────────────────────────────────────────

/// El criterio de la tarea: `--help` documenta todas las opciones.
#[test]
fn help_documents_every_option() {
    let dir = project();
    let output = galera(dir.path(), &["--help"]);

    assert!(output.status.success());
    let help = stdout(&output);
    for option in [
        "<ENTRADA>",
        "--output",
        "--format",
        "--page",
        "--emit-typst",
        "--help",
        "--version",
    ] {
        assert!(help.contains(option), "falta {option} en la ayuda:\n{help}");
    }
}
