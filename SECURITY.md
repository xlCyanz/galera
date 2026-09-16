# Política de seguridad

## Versiones con soporte

Galera está en desarrollo temprano y todavía no publica versiones estables. Solo se da soporte a la rama `main`.

| Versión | Soporte |
|---|---|
| `main` | ✅ |
| Cualquier build anterior | ❌ |

## Reportar una vulnerabilidad

**No abras una issue pública.**

Usa [Security → Report a vulnerability](https://github.com/xlCyanz/galera/security/advisories/new) en GitHub, o escribe a **johanse.linares@gmail.com** con el asunto `[SECURITY] galera`.

Incluye:

- Descripción del problema y su impacto.
- Pasos para reproducirlo, con un documento `.galera` o `document.json` mínimo si aplica.
- Versión de Galera (commit) y sistema operativo.

Tiempos objetivo: acuse de recibo en 72 horas, evaluación inicial en 7 días. Al publicar el arreglo se da crédito a quien reportó, salvo que prefiera lo contrario.

## Superficie de riesgo conocida

Galera abre archivos de terceros y los convierte en código que se compila. Los puntos sensibles son:

- **Escape de texto hacia Typst.** Un fallo aquí deja que el contenido de un documento inyecte código Typst arbitrario. Es el vector más importante del proyecto.
- **Bloques de código personalizado.** Son código Typst que el documento trae consigo y se ejecuta tal cual. Un `.galera` de origen desconocido debe tratarse como no confiable. Ese código se evalúa aislado con `eval`, que lo contiene dentro de su elemento y no le da acceso a disco: no puede leer archivos del proyecto ni importarlos. Ese aislamiento es una defensa, no una garantía; cualquier forma de salirse de él es una vulnerabilidad.
- **Carga de fuentes y assets.** Los archivos se leen desde la carpeta del proyecto; las rutas del documento no pueden escapar de ella.
- **Comandos de Tauri.** Toda entrada que cruce desde el webview hacia Rust se valida en el backend.

## Fuera de alcance

- Fallos del compilador oficial de Typst: repórtalos en <https://github.com/typst/typst>.
- Vulnerabilidades en dependencias sin impacto demostrable en Galera: abre una issue normal.
