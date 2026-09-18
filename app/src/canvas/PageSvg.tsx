/**
 * Una página tal como la dibuja Typst.
 *
 * La interfaz no dibuja nada del documento (principio 2): coloca el SVG de
 * Typst como imagen, del tamaño que le toca según el zoom. Como `<img>`, el
 * SVG no puede ejecutar nada ni mezclarse con el HTML de la interfaz.
 *
 * # Sin parpadeo al recompilar
 *
 * Cambiar el `src` de una imagen la deja en blanco hasta que la nueva se
 * decodifica. Para evitarlo, la imagen nueva se decodifica **aparte** y solo
 * cuando está lista sustituye a la anterior, que sigue a la vista mientras
 * tanto. Si llega otra versión antes de terminar, la que se estaba
 * preparando se descarta.
 */
import { useEffect, useState } from "react";

/** Cómo se convierte un SVG en una imagen lista para enseñar. */
export interface ImageLoader {
  /** Una dirección para el SVG, que habrá que liberar con `revokeUrl`. */
  createUrl: (svg: string) => string;
  /** Libera una dirección de `createUrl`. */
  revokeUrl: (url: string) => void;
  /** Termina cuando la imagen de esa dirección está decodificada. */
  decode: (url: string) => Promise<void>;
}

/**
 * El cargador del navegador: direcciones `blob:`, que no hace falta
 * codificar como texto, y `HTMLImageElement.decode`.
 */
export const browserImageLoader: ImageLoader = {
  createUrl: (svg) => URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })),
  revokeUrl: (url) => URL.revokeObjectURL(url),
  decode: (url) => {
    const image = new Image();
    image.src = url;
    return image.decode();
  },
};

/**
 * La dirección de la imagen que hay que enseñar para un SVG: la del SVG
 * nuevo en cuanto está decodificado y, hasta entonces, la del anterior.
 *
 * Con `svg` a `null` se sigue enseñando lo último que hubo.
 */
export function useDecodedSvgUrl(svg: string | null, loader: ImageLoader): string | null {
  const [shown, setShown] = useState<string | null>(null);

  useEffect(() => {
    if (svg === null) {
      return;
    }
    const url = loader.createUrl(svg);
    let current = true;

    // Si no se puede decodificar aparte, se enseña igualmente: la imagen
    // lo intentará por su cuenta.
    void loader
      .decode(url)
      .catch(() => undefined)
      .then(() => {
        if (current) {
          setShown(url);
        } else {
          loader.revokeUrl(url);
        }
      });

    return () => {
      current = false;
    };
  }, [svg, loader]);

  // La dirección que deja de enseñarse se libera después de cambiarla en
  // pantalla, y la última, al desmontar.
  useEffect(() => {
    if (shown === null) {
      return;
    }
    return () => loader.revokeUrl(shown);
  }, [shown, loader]);

  return shown;
}

export interface PageSvgProps {
  /** El SVG de la página, o `null` si todavía no hay ninguno. */
  svg: string | null;
  /** Ancho en píxeles CSS. */
  width: number;
  /** Alto en píxeles CSS. */
  height: number;
  /** Cómo se anuncia la página a un lector de pantalla. */
  label: string;
  /** Avisa de la imagen que se está enseñando, cada vez que cambia. */
  onShown?: (url: string | null) => void;
  /** Posición de la esquina superior izquierda en el área, en píxeles CSS. */
  left?: number;
  top?: number;
  /** Solo para pruebas. */
  loader?: ImageLoader;
}

/**
 * La hoja: un rectángulo blanco del tamaño de la página con el SVG encima.
 * Mientras no hay SVG, se ve la hoja en blanco, ya con su tamaño.
 */
export function PageSvg({
  svg,
  width,
  height,
  label,
  left = 0,
  top = 0,
  onShown,
  loader = browserImageLoader,
}: PageSvgProps) {
  const url = useDecodedSvgUrl(svg, loader);
  useEffect(() => onShown?.(url), [url, onShown]);

  return (
    <div
      className="canvas-page"
      role="img"
      aria-label={label}
      // `translate` y no `left`/`top`: mover la página no vuelve a maquetar.
      style={{ width, height, transform: `translate(${left}px, ${top}px)` }}
    >
      {url !== null && <img src={url} alt="" draggable={false} />}
    </div>
  );
}
