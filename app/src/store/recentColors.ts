/**
 * Los últimos colores usados en el selector de color, el más reciente
 * primero. Son de quien edita, no del documento: se recuerdan en este
 * navegador (si se puede) y no viajan con el proyecto.
 */
import { create } from "zustand";

/** Cuántos se recuerdan. */
export const RECENT_COLORS = 8;

const STORAGE_KEY = "galera.recentColors";

function load(): string[] {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    return Array.isArray(stored) ? stored.filter((color): color is string => typeof color === "string").slice(0, RECENT_COLORS) : [];
  } catch {
    return [];
  }
}

function save(colors: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(colors));
  } catch {
    // Sin almacenamiento, se recuerdan solo mientras la app está abierta.
  }
}

export interface RecentColorsState {
  colors: string[];
  /** Pone un color el primero, sin repetirlo. */
  use: (color: string) => void;
}

export const useRecentColors = create<RecentColorsState>()((set) => ({
  colors: load(),
  use: (color) =>
    set((state) => {
      const colors = [color.toLowerCase(), ...state.colors.filter((known) => known !== color.toLowerCase())].slice(
        0,
        RECENT_COLORS,
      );
      save(colors);
      return { colors };
    }),
}));
