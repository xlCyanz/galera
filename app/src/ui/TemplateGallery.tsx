/**
 * La galería de plantillas: de qué se puede partir para un documento nuevo.
 *
 * Cada plantilla se ve **compuesta por Typst**, como todo lo demás del
 * documento (principio 2): la vista previa es su primera página compilada,
 * no una imagen guardada que pueda quedarse vieja.
 *
 * Elegir una pregunta dónde guardar el documento nuevo, **copia la
 * plantilla entera** —fuentes y recursos incluidos— y abre la copia. A
 * partir de ahí es un proyecto normal: no queda enlazado a la plantilla.
 */
import { useEffect, useState } from "react";

import { type TemplateCard, errorMessage, newFromTemplate, templates } from "../commands";
import { browserImageLoader, useDecodedSvgUrl } from "../canvas/PageSvg";
import type { ImageLoader } from "../canvas/PageSvg";
import { useDocumentStore } from "../store/document";

export interface TemplateGalleryProps {
  /** Solo para pruebas: cómo se convierte un SVG en imagen. */
  loader?: ImageLoader;
}

export function TemplateGallery({ loader = browserImageLoader }: TemplateGalleryProps = {}) {
  const [cards, setCards] = useState<TemplateCard[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [creating, setCreating] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    void templates()
      .then((found) => {
        if (current) {
          setCards(found);
        }
      })
      .catch((reason: unknown) => {
        if (current) {
          setCards([]);
          setMessage(errorMessage(reason));
        }
      });
    return () => {
      current = false;
    };
  }, []);

  const create = (id: string, archive: boolean) => {
    setCreating(id);
    setMessage(null);
    void newFromTemplate(id, archive)
      .then((opened) => {
        if (opened !== null) {
          useDocumentStore.getState().open(opened);
        }
      })
      .catch((reason: unknown) => setMessage(errorMessage(reason)))
      .finally(() => setCreating(null));
  };

  if (cards !== null && cards.length === 0 && message === null) {
    return null;
  }

  return (
    <section className="template-gallery" aria-label="Plantillas">
      <h2>Empezar con una plantilla</h2>
      {message !== null && (
        <p className="assets-message" role="alert">
          {message}
        </p>
      )}
      {cards === null ? (
        <p className="layers-empty">Buscando plantillas…</p>
      ) : (
        <ul className="templates">
          {cards.map((card) => (
            <li key={card.id} className="template" data-template={card.id}>
              <Preview svg={card.preview} name={card.name} loader={loader} />
              <h3>{card.name}</h3>
              <p className="template-description">{card.description}</p>
              {card.variables.length > 0 && (
                <p className="template-variables">
                  Variables: {card.variables.join(", ")}
                </p>
              )}
              <div className="template-actions">
                <button
                  type="button"
                  disabled={creating !== null}
                  onClick={() => create(card.id, false)}
                >
                  Usar en una carpeta…
                </button>
                <button
                  type="button"
                  disabled={creating !== null}
                  onClick={() => create(card.id, true)}
                >
                  Usar en un .galera…
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** La primera página de la plantilla, compuesta. */
function Preview({
  svg,
  name,
  loader,
}: {
  svg: string | null;
  name: string;
  loader: ImageLoader;
}) {
  const url = useDecodedSvgUrl(svg, loader);
  return (
    <span className="template-preview">
      {url === null ? null : <img src={url} alt={`Vista previa de ${name}`} />}
    </span>
  );
}
