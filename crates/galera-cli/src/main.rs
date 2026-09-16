//! Herramienta de terminal de Galera.
//!
//! Convierte un documento de Galera en PDF o SVG usando `galera-core`, sin
//! interfaz gráfica. Sirve para probar el núcleo de punta a punta y para
//! depurar el código Typst que genera el editor.
//!
//! ```text
//! galera-cli fixtures/informe.json -o salida.pdf
//! galera-cli fixtures/informe.json -o portada.svg --page 1
//! galera-cli fixtures/informe.json --emit-typst
//! ```
//!
//! Toda la lógica vive en `galera-core` (principio 5 del README). Aquí solo
//! se leen argumentos, se cargan archivos y se escriben resultados.
//!
//! # Nota de Rust
//!
//! `clap` con la macro `derive` define la línea de órdenes como un struct:
//! cada campo es una opción, los comentarios `///` son su ayuda, y los
//! atributos `#[arg(...)]` dicen cómo se escribe. `--help` sale de ahí solo.

use std::fmt;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use clap::{Parser, ValueEnum};
use galera_core::{CompileError, Document, Project, ProjectError, Severity, codegen, compile};

/// Formato de salida.
#[derive(Copy, Clone, Debug, PartialEq, Eq, ValueEnum)]
enum Format {
    /// Documento PDF, con todas las páginas y las fuentes incrustadas.
    Pdf,
    /// Una sola página en SVG: lo mismo que muestra el lienzo del editor.
    Svg,
}

/// Convierte un documento de Galera en PDF o SVG.
///
/// La entrada puede ser un archivo JSON o la carpeta de un proyecto que
/// contenga `document.json`. Las fuentes y las imágenes se buscan en la
/// carpeta donde está el documento.
#[derive(Debug, Parser)]
#[command(name = "galera-cli", version, about, long_about)]
struct Args {
    /// Documento de entrada: un archivo `.json` o la carpeta de un proyecto.
    #[arg(value_name = "ENTRADA")]
    input: PathBuf,

    /// Archivo de salida.
    ///
    /// Obligatorio para PDF y SVG. Con `--emit-typst`, si no se da, el código
    /// se escribe por la salida estándar.
    #[arg(short, long, value_name = "ARCHIVO")]
    output: Option<PathBuf>,

    /// Formato de salida.
    ///
    /// Si no se indica, se deduce de la extensión de `--output`, y si tampoco
    /// hay extensión reconocible, es PDF.
    #[arg(short, long, value_enum)]
    format: Option<Format>,

    /// Página que se exporta a SVG, empezando en 1.
    ///
    /// Solo tiene sentido con SVG: un PDF lleva siempre todas las páginas.
    #[arg(short, long, value_name = "N", value_parser = clap::value_parser!(u32).range(1..))]
    page: Option<u32>,

    /// En vez de compilar, escribe el código Typst que genera Galera.
    ///
    /// Sirve para depurar: es exactamente lo que recibe el compilador.
    #[arg(long, conflicts_with_all = ["format", "page"])]
    emit_typst: bool,
}

/// Algo impidió terminar. Cada variante lleva el contexto necesario para que
/// el mensaje diga qué archivo y qué paso fallaron.
#[derive(Debug)]
enum CliError {
    Unsupported {
        path: PathBuf,
        reason: &'static str,
    },
    Read {
        path: PathBuf,
        source: io::Error,
    },
    Parse {
        path: PathBuf,
        source: serde_json::Error,
    },
    Project(ProjectError),
    Codegen {
        path: PathBuf,
        source: codegen::CodegenError,
    },
    Compile {
        path: PathBuf,
        source: CompileError,
    },
    MissingOutput {
        format: Format,
    },
    Write {
        path: PathBuf,
        source: io::Error,
    },
}

impl fmt::Display for CliError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CliError::Unsupported { path, reason } => {
                write!(f, "no se puede abrir {}: {reason}", path.display())
            }
            CliError::Read { path, source } => {
                write!(f, "no se puede leer {}: {source}", path.display())
            }
            CliError::Parse { path, source } => {
                write!(f, "{} no es un documento válido: {source}", path.display())
            }
            CliError::Project(source) => write!(f, "{source}"),
            CliError::Codegen { path, source } => {
                write!(
                    f,
                    "no se pudo generar el código de {}: {source}",
                    path.display()
                )
            }
            CliError::Compile { path, source } => {
                write!(f, "no se pudo compilar {}: {source}", path.display())
            }
            CliError::MissingOutput { format } => {
                let example = match format {
                    Format::Pdf => "salida.pdf",
                    Format::Svg => "salida.svg",
                };
                write!(
                    f,
                    "falta el archivo de salida; usa, por ejemplo, -o {example}"
                )
            }
            CliError::Write { path, source } => {
                write!(f, "no se puede escribir {}: {source}", path.display())
            }
        }
    }
}

fn main() -> ExitCode {
    let args = Args::parse();

    match run(&args) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("error: {error}");
            ExitCode::FAILURE
        }
    }
}

fn run(args: &Args) -> Result<(), CliError> {
    let (document_path, root) = locate(&args.input)?;
    let document = load_document(&document_path)?;

    if args.emit_typst {
        let source = codegen::generate(&document).map_err(|source| CliError::Codegen {
            path: document_path.clone(),
            source,
        })?;
        return match &args.output {
            Some(path) => write_file(path, source.as_bytes()),
            None => io::stdout()
                .write_all(source.as_bytes())
                .map_err(|source| CliError::Write {
                    path: PathBuf::from("<salida estándar>"),
                    source,
                }),
        };
    }

    let format = args
        .format
        .or_else(|| args.output.as_deref().and_then(format_from_extension))
        .unwrap_or(Format::Pdf);

    let output = args
        .output
        .as_deref()
        .ok_or(CliError::MissingOutput { format })?;

    let project = Project::open(&root).map_err(CliError::Project)?;
    let compiled = compile(&document, &project).map_err(|source| CliError::Compile {
        path: document_path.clone(),
        source,
    })?;

    for warning in compiled.warnings() {
        let kind = match warning.severity {
            Severity::Error => "error",
            Severity::Warning => "aviso",
        };
        eprintln!("{kind}: {}", warning.message);
    }

    let compile_error = |source| CliError::Compile {
        path: document_path.clone(),
        source,
    };

    match format {
        Format::Pdf => {
            if args.page.is_some() {
                eprintln!("aviso: --page se ignora con PDF, que lleva todas las páginas");
            }
            let pdf = compiled.to_pdf().map_err(compile_error)?;
            write_file(output, &pdf)?;
            let pages = compiled.page_count();
            eprintln!(
                "{}: {pages} {}",
                output.display(),
                if pages == 1 { "página" } else { "páginas" }
            );
        }
        Format::Svg => {
            let page = args.page.unwrap_or(1);
            // En la terminal las páginas empiezan en 1; en el núcleo, en 0.
            let svg = compiled
                .to_svg(page as usize - 1)
                .map_err(|error| match error {
                    CompileError::PageOutOfRange { count, .. } => CliError::Compile {
                        path: document_path.clone(),
                        source: CompileError::PageOutOfRange {
                            page: page as usize,
                            count,
                        },
                    },
                    other => compile_error(other),
                })?;
            write_file(output, svg.as_bytes())?;
            eprintln!("{}: página {page}", output.display());
        }
    }

    Ok(())
}

/// Decide qué archivo es el documento y cuál es la carpeta del proyecto.
fn locate(input: &Path) -> Result<(PathBuf, PathBuf), CliError> {
    if input.is_dir() {
        return Ok((input.join("document.json"), input.to_owned()));
    }

    if input
        .extension()
        .is_some_and(|extension| extension == "galera")
    {
        return Err(CliError::Unsupported {
            path: input.to_owned(),
            reason: "el formato .galera todavía no existe (tarea F3-11); usa la carpeta del proyecto o su JSON",
        });
    }

    let root = match input.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent.to_owned(),
        _ => PathBuf::from("."),
    };
    Ok((input.to_owned(), root))
}

fn load_document(path: &Path) -> Result<Document, CliError> {
    let json = std::fs::read_to_string(path).map_err(|source| CliError::Read {
        path: path.to_owned(),
        source,
    })?;

    Document::from_json_str(&json).map_err(|source| CliError::Parse {
        path: path.to_owned(),
        source,
    })
}

fn format_from_extension(path: &Path) -> Option<Format> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "pdf" => Some(Format::Pdf),
        "svg" => Some(Format::Svg),
        _ => None,
    }
}

fn write_file(path: &Path, bytes: &[u8]) -> Result<(), CliError> {
    std::fs::write(path, bytes).map_err(|source| CliError::Write {
        path: path.to_owned(),
        source,
    })
}
