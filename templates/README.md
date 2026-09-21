# Plantillas

De lo que se parte para hacer un documento nuevo. Las que hay aquí son las
que **trae la aplicación**: se empaquetan con ella (`bundle.resources` de
`tauri.conf.json`) y salen en la galería al abrir Galera sin nada.

## Qué es una plantilla

**Un proyecto de Galera con un archivo más.** Ni un formato aparte ni un
lenguaje de plantillas: la misma carpeta que cualquier documento, con un
`template.json` al lado que dice cómo se llama y de qué es.

```text
templates/
  informe/
    template.json     ← el nombre, la descripción y el grupo
    document.json     ← el documento, con sus variables declaradas
    fonts/            ← las fuentes que necesita para componerse
    assets/           ← sus imágenes
```

### `template.json`

```json
{
  "name": "Informe sencillo",
  "description": "Una portada con banda de color, título y pie.",
  "category": "negocio"
}
```

- **`name`** es lo que se lee en la galería.
- **`description`** es una línea: qué es y para qué sirve.
- **`category`** agrupa las plantillas y se puede omitir.

### `document.json`

El documento tal cual, con una diferencia de costumbre: **sus variables se
declaran vacías**. Lo que se escribe en los textos son fichas —`{{empresa}}`,
`{{fecha}}`— que se ven en la página escritas así hasta que alguien les da
valor, y eso es exactamente lo que se quiere de una plantilla recién puesta.

Las fuentes que use tienen que estar en su `fonts/`: la copia se lleva la
carpeta entera, y un documento que dependa de una fuente del sistema se
compondría distinto en otro ordenador (principio 4).

## Qué pasa al usar una

Se **copia entera** —documento, fuentes y recursos— a donde diga quien la
usa, y se abre la copia. El documento nuevo:

- se llama como la carpeta o el archivo que se eligió, no como la plantilla;
- **no queda enlazado**: no guarda de cuál salió, y cambiar la plantilla más
  tarde no toca lo que ya se hizo con ella;
- no lleva `template.json`, porque ya no es una plantilla.

## Añadir una

Una carpeta más aquí, con sus dos archivos. No hay que registrarla en ningún
sitio: la galería lee esta carpeta y enseña lo que encuentre, componiendo la
primera página de cada una para la vista previa. Lo que no tenga
`template.json` y `document.json` se salta sin ruido.
