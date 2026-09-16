//! Herramienta de terminal de Galera.
//!
//! Convierte un documento JSON en PDF o SVG usando `galera-core`, sin
//! interfaz gráfica. Sirve para probar el núcleo de punta a punta y para
//! depurar el código Typst que genera el editor.
//!
//! Por ahora solo existe el esqueleto de la línea de órdenes: la conversión
//! real se implementa en la tarea F0-14, cuando el núcleo ya sepa compilar.

use std::process::ExitCode;

use clap::{Parser, ValueEnum};

/// Formato de salida.
#[derive(Copy, Clone, Debug, PartialEq, Eq, ValueEnum)]
enum Formato {
    /// Documento PDF (el formato de entrega).
    Pdf,
    /// SVG de una sola página (el mismo que muestra el lienzo del editor).
    Svg,
}

/// Convierte un documento de Galera en PDF o SVG.
#[derive(Debug, Parser)]
#[command(name = "galera-cli", version, about, long_about = None)]
struct Args {
    /// Documento de entrada (`document.json` o un `.galera`).
    entrada: std::path::PathBuf,

    /// Archivo de salida.
    #[arg(short, long, value_name = "ARCHIVO")]
    output: Option<std::path::PathBuf>,

    /// Formato de salida.
    #[arg(short, long, value_enum, default_value_t = Formato::Pdf)]
    format: Formato,
}

fn main() -> ExitCode {
    let args = Args::parse();

    eprintln!(
        "galera-cli {}: la conversión todavía no está implementada (tarea F0-14).",
        galera_core::version()
    );
    eprintln!(
        "Entrada: {}, formato: {:?}, salida: {}",
        args.entrada.display(),
        args.format,
        args.output
            .as_deref()
            .map(|p| p.display().to_string())
            .unwrap_or_else(|| "sin definir".to_owned())
    );

    ExitCode::FAILURE
}
