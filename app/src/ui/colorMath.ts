/**
 * Las cuentas del selector de color, sin DOM: leer y escribir los colores
 * del modelo, y pasar entre RGB y HSV para la rueda.
 *
 * El modelo guarda los colores como texto hexadecimal: `#RGB`, `#RGBA`,
 * `#RRGGBB` o `#RRGGBBAA` (lo que entiende `rgb()` de Typst). Aquí se
 * escriben siempre largos y en minúsculas, y con alfa solo si no es opaco.
 */

/** Un color: canales de 0 a 255 y opacidad de 0 a 1. */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Tono (0–360), saturación y valor (0–1). */
export interface Hsv {
  h: number;
  s: number;
  v: number;
}

/** Un color del modelo, o `null` si no es un hexadecimal válido. */
export function parseColor(text: string): Rgba | null {
  const match = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(text.trim());
  if (match === null) {
    return null;
  }
  let hex = match[1]!;
  if (hex.length <= 4) {
    hex = [...hex].map((digit) => digit + digit).join("");
  }
  const channel = (at: number) => Number.parseInt(hex.slice(at, at + 2), 16);
  return { r: channel(0), g: channel(2), b: channel(4), a: hex.length === 8 ? channel(6) / 255 : 1 };
}

/** Un color como lo guarda el modelo: `#rrggbb`, o `#rrggbbaa` si no es opaco. */
export function formatColor({ r, g, b, a }: Rgba): string {
  const byte = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, "0");
  const alpha = Math.round(Math.max(0, Math.min(1, a)) * 255);
  return `#${byte(r)}${byte(g)}${byte(b)}${alpha === 255 ? "" : byte(alpha)}`;
}

export function rgbToHsv({ r, g, b }: Rgba): Hsv {
  const [red, green, blue] = [r / 255, g / 255, b / 255];
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === red) {
      h = 60 * (((green - blue) / delta) % 6);
    } else if (max === green) {
      h = 60 * ((blue - red) / delta + 2);
    } else {
      h = 60 * ((red - green) / delta + 4);
    }
  }
  return { h: (h + 360) % 360, s: max === 0 ? 0 : delta / max, v: max };
}

export function hsvToRgb({ h, s, v }: Hsv, a = 1): Rgba {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [red, green, blue] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return { r: (red + m) * 255, g: (green + m) * 255, b: (blue + m) * 255, a };
}

/**
 * El tono y la saturación de un punto de la rueda: el ángulo da el tono (0°
 * arriba, en sentido horario) y la distancia al centro, la saturación.
 *
 * @param x, y El punto respecto al centro, en píxeles.
 * @param radius El radio de la rueda.
 */
export function wheelToHs(x: number, y: number, radius: number): { h: number; s: number } {
  const angle = (Math.atan2(x, -y) * 180) / Math.PI;
  return { h: (angle + 360) % 360, s: Math.min(1, Math.hypot(x, y) / radius) };
}

/** El punto de la rueda de un tono y una saturación, respecto al centro. */
export function hsToWheel(h: number, s: number, radius: number): { x: number; y: number } {
  const angle = (h * Math.PI) / 180;
  return { x: Math.sin(angle) * s * radius, y: -Math.cos(angle) * s * radius };
}
