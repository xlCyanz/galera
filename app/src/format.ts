/**
 * Textos que enseña la interfaz a partir del estado.
 */
import type { CompilationStatus } from "./store/compilation";

/** Un peso en bytes, en la unidad que toque: «812 B», «12,3 KB», «4,1 MB». */
export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 ? 0 : 1;
  return `${value.toLocaleString("es", { maximumFractionDigits: digits })} ${units[unit]}`;
}

/** Un tiempo en milisegundos, con un decimal como mucho: «12,3 ms». */
export function formatMs(ms: number): string {
  return `${ms.toLocaleString("es", { maximumFractionDigits: 1 })} ms`;
}

/**
 * El estado de la compilación para la barra de estado, con el tiempo de la
 * última: «Compilado en 12,3 ms», «No compila (3 ms)», «Compilando…».
 */
export function compilationStatusText(
  status: CompilationStatus,
  ms: number | null,
  reused: boolean,
): string {
  switch (status) {
    case "idle":
      return "Sin documento";
    case "compiling":
      return "Compilando…";
    case "ready":
      if (ms === null) {
        return "Compilado";
      }
      return reused ? `Compilado en ${formatMs(ms)} (sin cambios)` : `Compilado en ${formatMs(ms)}`;
    case "error":
      return ms === null ? "No compila" : `No compila (${formatMs(ms)})`;
  }
}
