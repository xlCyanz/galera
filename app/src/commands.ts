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
 * Comando de prueba: el backend devuelve el mensaje con un prefijo.
 *
 * Sirve para comprobar que la interfaz y Rust se hablan. Desaparecerá cuando
 * haya comandos de verdad (F1-03).
 */
export function ping(message: string): Promise<string> {
  return invoke<string>("ping", { message });
}
