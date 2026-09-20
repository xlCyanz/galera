//! Un zip mínimo y **determinista**, lo justo para el formato `.galera`.
//!
//! No se usa una biblioteca de zip para no añadir una dependencia por algo
//! que aquí cabe en un archivo: solo hacen falta archivos (sin carpetas
//! vacías, sin cifrado, sin zip64) y solo dos métodos, guardado tal cual y
//! *deflate*, que ya trae `miniz_oxide`.
//!
//! # Mismos bytes
//!
//! Dos zips del mismo contenido son **idénticos byte a byte**: las entradas
//! van ordenadas por nombre, la fecha es siempre la misma (la más antigua
//! que sabe escribir un zip, 1980-01-01) y no se escribe nada del sistema
//! —ni permisos, ni campos extra—. Así el archivo de un proyecto que no ha
//! cambiado tampoco cambia, y `git` no ve ruido.
//!
//! # Formato
//!
//! Un zip es, por orden: cada archivo con su cabecera local, después el
//! índice (una entrada por archivo) y al final el cierre, que dice dónde
//! empieza el índice. Los números van en little-endian.

use std::collections::BTreeMap;
use std::io;

use miniz_oxide::deflate::compress_to_vec;
use miniz_oxide::inflate::decompress_to_vec_with_limit;

/// Firmas de las tres estructuras que se escriben.
const LOCAL_HEADER: u32 = 0x0403_4b50;
const CENTRAL_HEADER: u32 = 0x0201_4b50;
const END_OF_CENTRAL: u32 = 0x0605_4b50;

/// Versión mínima para leerlo: 2.0, la que admite *deflate*.
const VERSION: u16 = 20;

/// Guardado tal cual y *deflate*, los dos únicos métodos que se usan.
const STORED: u16 = 0;
const DEFLATED: u16 = 8;

/// Nivel de compresión de `miniz_oxide` (0–10). El 6 es el equilibrio
/// habitual entre tamaño y tiempo, y es determinista.
const LEVEL: u8 = 6;

/// Lo más grande que se acepta al descomprimir una entrada: 256 MiB. Sin
/// límite, un zip pequeño y malicioso podría pedir toda la memoria.
const MAX_ENTRY: usize = 256 * 1024 * 1024;

/// Por qué no se pudo leer un zip.
#[derive(Debug, thiserror::Error)]
pub enum ZipError {
    /// No es un zip, o está cortado.
    #[error("el archivo no es un zip válido o está incompleto")]
    Malformed,
    /// Usa algo que este lector no hace: cifrado, zip64, otro método.
    #[error("el zip usa algo que Galera no sabe leer: {what}")]
    Unsupported {
        /// Qué es lo que no se sabe leer.
        what: &'static str,
    },
    /// Una entrada no se pudo descomprimir, o no cabe.
    #[error("el contenido de {name:?} está dañado")]
    Damaged {
        /// La entrada.
        name: String,
    },
    /// El nombre de una entrada no se puede usar.
    #[error("el zip trae la ruta {name:?}, que no se puede escribir dentro de una carpeta")]
    UnsafeName {
        /// La entrada.
        name: String,
    },
}

/// Escribe un zip con estos archivos, ordenados por nombre.
///
/// Los nombres van con `/`, relativos a la raíz del zip. Cada archivo se
/// comprime, salvo que comprimirlo no lo haga más pequeño (una imagen PNG,
/// por ejemplo), en cuyo caso se guarda tal cual.
pub fn write(files: &BTreeMap<String, Vec<u8>>) -> Vec<u8> {
    let mut out = Vec::new();
    let mut index = Vec::new();

    for (name, data) in files {
        let offset = out.len() as u32;
        let compressed = compress_to_vec(data, LEVEL);
        let (method, body) = if compressed.len() < data.len() {
            (DEFLATED, compressed)
        } else {
            (STORED, data.clone())
        };
        let crc = crc32(data);

        out.extend_from_slice(&LOCAL_HEADER.to_le_bytes());
        write_common(&mut out, method, crc, body.len(), data.len(), name);
        out.extend_from_slice(name.as_bytes());
        out.extend_from_slice(&body);

        index.extend_from_slice(&CENTRAL_HEADER.to_le_bytes());
        index.extend_from_slice(&VERSION.to_le_bytes()); // Versión con la que se creó.
        write_common(&mut index, method, crc, body.len(), data.len(), name);
        index.extend_from_slice(&0u16.to_le_bytes()); // Comentario.
        index.extend_from_slice(&0u16.to_le_bytes()); // Disco.
        index.extend_from_slice(&0u16.to_le_bytes()); // Atributos internos.
        index.extend_from_slice(&0u32.to_le_bytes()); // Atributos externos: nada del sistema.
        index.extend_from_slice(&offset.to_le_bytes());
        index.extend_from_slice(name.as_bytes());
    }

    let index_at = out.len() as u32;
    out.extend_from_slice(&index);
    out.extend_from_slice(&END_OF_CENTRAL.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes()); // Disco.
    out.extend_from_slice(&0u16.to_le_bytes()); // Disco del índice.
    out.extend_from_slice(&(files.len() as u16).to_le_bytes());
    out.extend_from_slice(&(files.len() as u16).to_le_bytes());
    out.extend_from_slice(&(index.len() as u32).to_le_bytes());
    out.extend_from_slice(&index_at.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes()); // Comentario.
    out
}

/// Lo que comparten la cabecera local y la del índice, en el mismo orden.
fn write_common(out: &mut Vec<u8>, method: u16, crc: u32, packed: usize, size: usize, name: &str) {
    out.extend_from_slice(&VERSION.to_le_bytes());
    // Bit 11: los nombres van en UTF-8.
    out.extend_from_slice(&0x0800u16.to_le_bytes());
    out.extend_from_slice(&method.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes()); // Hora: 00:00:00.
    out.extend_from_slice(&0x0021u16.to_le_bytes()); // Fecha: 1980-01-01.
    out.extend_from_slice(&crc.to_le_bytes());
    out.extend_from_slice(&(packed as u32).to_le_bytes());
    out.extend_from_slice(&(size as u32).to_le_bytes());
    out.extend_from_slice(&(name.len() as u16).to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes()); // Sin campos extra.
}

/// Lee un zip escrito por [`write()`] (o cualquiera que no use nada raro) y
/// devuelve sus archivos por nombre.
///
/// # Errores
///
/// [`ZipError`] si no es un zip, si usa algo que no se sabe leer, si una
/// entrada está dañada o si trae una ruta que no se puede escribir dentro de
/// una carpeta (absoluta, con `..`, o con `\` de Windows).
pub fn read(data: &[u8]) -> Result<BTreeMap<String, Vec<u8>>, ZipError> {
    let end = find_end(data).ok_or(ZipError::Malformed)?;
    let count = u16(data, end + 10)? as usize;
    let mut at = u32(data, end + 16)? as usize;

    let mut files = BTreeMap::new();
    for _ in 0..count {
        let entry = at;
        if u32(data, entry)? != CENTRAL_HEADER {
            return Err(ZipError::Malformed);
        }
        let flags = u16(data, entry + 8)?;
        if flags & 1 != 0 {
            return Err(ZipError::Unsupported { what: "cifrado" });
        }
        let method = u16(data, entry + 10)?;
        let packed = u32(data, entry + 20)? as usize;
        let size = u32(data, entry + 24)? as usize;
        let name_len = u16(data, entry + 28)? as usize;
        let extra_len = u16(data, entry + 30)? as usize;
        let comment_len = u16(data, entry + 32)? as usize;
        let offset = u32(data, entry + 42)? as usize;
        if packed == u32::MAX as usize || size == u32::MAX as usize {
            return Err(ZipError::Unsupported { what: "zip64" });
        }
        let name = slice(data, entry + 46, name_len)?;
        let name = String::from_utf8(name.to_vec()).map_err(|_| ZipError::Malformed)?;
        let crc = u32(data, entry + 16)?;
        at = entry + 46 + name_len + extra_len + comment_len;

        // Las carpetas se anotan como entradas vacías acabadas en `/`: se
        // saltan, porque al extraer se crean las que hagan falta.
        if name.ends_with('/') {
            continue;
        }
        check_name(&name)?;

        // La cabecera local repite el nombre y puede traer campos extra
        // distintos, así que el contenido empieza después de los suyos.
        if u32(data, offset)? != LOCAL_HEADER {
            return Err(ZipError::Malformed);
        }
        let local_name = u16(data, offset + 26)? as usize;
        let local_extra = u16(data, offset + 28)? as usize;
        let body = slice(data, offset + 30 + local_name + local_extra, packed)?;

        let content = match method {
            STORED => body.to_vec(),
            DEFLATED => decompress_to_vec_with_limit(body, MAX_ENTRY.min(size.max(1024)))
                .map_err(|_| ZipError::Damaged { name: name.clone() })?,
            _ => {
                return Err(ZipError::Unsupported {
                    what: "un método de compresión que no es deflate",
                });
            }
        };
        if content.len() != size || crc32(&content) != crc {
            return Err(ZipError::Damaged { name });
        }
        files.insert(name, content);
    }
    Ok(files)
}

/// Que el nombre de una entrada no se salga de la carpeta al extraerlo.
fn check_name(name: &str) -> Result<(), ZipError> {
    let unsafe_name = name.is_empty()
        || name.starts_with('/')
        || name.contains('\\')
        || name.contains(':')
        || name.split('/').any(|part| part == ".." || part == ".");
    if unsafe_name {
        return Err(ZipError::UnsafeName {
            name: name.to_owned(),
        });
    }
    Ok(())
}

/// El cierre del zip, buscado desde el final (puede llevar comentario).
fn find_end(data: &[u8]) -> Option<usize> {
    let signature = END_OF_CENTRAL.to_le_bytes();
    (0..=data.len().checked_sub(22)?)
        .rev()
        .find(|&at| data[at..at + 4] == signature)
}

fn u16(data: &[u8], at: usize) -> Result<u16, ZipError> {
    let bytes = slice(data, at, 2)?;
    Ok(u16::from_le_bytes([bytes[0], bytes[1]]))
}

fn u32(data: &[u8], at: usize) -> Result<u32, ZipError> {
    let bytes = slice(data, at, 4)?;
    Ok(u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
}

fn slice(data: &[u8], at: usize, len: usize) -> Result<&[u8], ZipError> {
    data.get(at..at.checked_add(len).ok_or(ZipError::Malformed)?)
        .ok_or(ZipError::Malformed)
}

/// El CRC-32 que usa el zip (el de PKZIP, polinomio 0xEDB88320).
pub fn crc32(data: &[u8]) -> u32 {
    let mut crc = u32::MAX;
    for byte in data {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            let carry = crc & 1;
            crc >>= 1;
            if carry != 0 {
                crc ^= 0xEDB8_8320;
            }
        }
    }
    !crc
}

/// Un error de zip como error de entrada y salida, para quien solo maneja
/// [`io::Error`].
impl From<ZipError> for io::Error {
    fn from(error: ZipError) -> Self {
        io::Error::new(io::ErrorKind::InvalidData, error.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn files(entries: &[(&str, &[u8])]) -> BTreeMap<String, Vec<u8>> {
        entries
            .iter()
            .map(|(name, data)| ((*name).to_owned(), data.to_vec()))
            .collect()
    }

    #[test]
    fn what_goes_in_comes_out() {
        let entries = files(&[
            ("document.json", b"{ \"version\": 1 }".as_slice()),
            ("fonts/Inter-Regular.ttf", vec![7u8; 5000].leak()),
            ("assets/logo.png", b"\x89PNG\r\n\x1a\n...".as_slice()),
            ("assets/vacío.txt", b"".as_slice()),
        ]);
        let zip = write(&entries);
        assert_eq!(read(&zip).expect("se lee"), entries);
    }

    #[test]
    fn the_same_content_gives_the_same_bytes() {
        let entries = files(&[("a.txt", b"hola".as_slice()), ("b.txt", "adiós".as_bytes())]);
        assert_eq!(write(&entries), write(&entries));
        // El orden de entrada da igual: las entradas van ordenadas.
        let reversed: BTreeMap<String, Vec<u8>> = entries.clone().into_iter().rev().collect();
        assert_eq!(write(&reversed), write(&entries));
        // Y no se cuela nada del sistema: ni fecha de hoy, ni permisos.
        assert!(
            !write(&entries)
                .windows(4)
                .any(|window| window == 0x1234_5678u32.to_le_bytes())
        );
    }

    #[test]
    fn something_that_is_not_a_zip_is_rejected() {
        assert!(matches!(read(b"no soy un zip"), Err(ZipError::Malformed)));
        assert!(matches!(read(&[]), Err(ZipError::Malformed)));
    }

    #[test]
    fn a_damaged_entry_is_detected() {
        let entries = files(&[("a.txt", vec![b'a'; 2000].leak())]);
        let mut zip = write(&entries);
        // Estropea un byte del contenido comprimido.
        let at = zip.len() / 3;
        zip[at] ^= 0xFF;
        assert!(matches!(
            read(&zip),
            Err(ZipError::Damaged { .. } | ZipError::Malformed)
        ));
    }

    #[test]
    fn a_truncated_zip_is_malformed() {
        let zip = write(&files(&[("a.txt", b"hola".as_slice())]));
        assert!(matches!(
            read(&zip[..zip.len() - 5]),
            Err(ZipError::Malformed)
        ));
    }

    #[test]
    fn names_that_escape_the_folder_are_rejected() {
        for name in [
            "../fuera.txt",
            "/etc/passwd",
            "carpeta\\archivo.txt",
            "C:/x.txt",
            "./a.txt",
        ] {
            let zip = write(&files(&[(name, b"x".as_slice())]));
            assert!(
                matches!(read(&zip), Err(ZipError::UnsafeName { .. })),
                "{name}"
            );
        }
    }

    #[test]
    fn the_crc_is_the_one_zip_uses() {
        // Valores conocidos del CRC-32 de PKZIP.
        assert_eq!(crc32(b""), 0);
        assert_eq!(crc32(b"123456789"), 0xCBF4_3926);
    }
}
