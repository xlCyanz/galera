/**
 * Llamadas al backend de Tauri.
 *
 * Toda comunicación con Rust pasa por aquí, con tipos, en vez de repartir
 * `invoke("nombre")` con cadenas sueltas por los componentes. Si un comando
 * cambia de nombre o de argumentos, se arregla en un solo sitio.
 *
 * Nota de Tauri: `invoke` envía un mensaje al proceso Rust y devuelve una
 * promesa con lo que responda la función marcada con `#[tauri::command]` del
 * mismo nombre. Los argumentos van en un objeto cuyas claves son los nombres
 * de los parámetros de esa función.
 */
import { invoke } from "@tauri-apps/api/core";

/**
 * El estado de la sesión, tal como lo devuelve `session_status`.
 *
 * Tiene que coincidir con `SessionStatus` de `src-tauri/src/commands.rs`. Una
 * prueba en Rust fija los nombres de los campos; a partir de F1-06 este tipo
 * se generará desde Rust en vez de escribirse a mano.
 */
export interface SessionStatus {
  /** La versión de `galera-core` con la que está compilada la app. */
  coreVersion: string;
  /** El título del documento abierto, o `null` si no hay ninguno. */
  title: string | null;
  /** Cuántas páginas tiene el documento abierto. */
  pageCount: number;
  /** Si la última compilación corresponde a lo que hay abierto. */
  compiledIsCurrent: boolean;
}

/** Pide al backend el estado de la sesión. */
export function sessionStatus(): Promise<SessionStatus> {
  return invoke<SessionStatus>("session_status");
}
