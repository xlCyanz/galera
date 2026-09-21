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

El documento tal cual, con una costumbre: **sus variables se declaran con un
valor de ejemplo**. Lo que se escribe en los textos son fichas
—`{{empresa}}`, `{{fecha}}`—, y el valor es lo que se ve en su sitio hasta
que alguien lo cambia.

De ejemplo y no vacías por dos razones: la galería compone la primera página
para la vista previa, y una plantilla llena de `{{empresa}}` no enseña de qué
va; y una ficha sin valor es un aviso del panel de problemas, así que una
plantilla recién abierta saldría quejándose sin que nadie haya hecho nada.

Las fuentes que use tienen que estar en su `fonts/`: la copia se lleva la
carpeta entera, y un documento que dependa de una fuente del sistema se
compondría distinto en otro ordenador (principio 4).

## Las que trae la aplicación

| Carpeta | Qué es | Qué enseña |
|---|---|---|
| `informe` | Portada con banda de color, título y pie. | Lo mínimo: variables en un texto. |
| `factura` | Cabecera con las dos partes y una tabla de conceptos. | Tablas, con celdas combinadas y su total. |
| `carta` | Membrete, fecha y cuerpo sobre una firma fija. | Un cuerpo que fluye y crece sin recolocar nada. |
| `certificado` | Apaisado, con orla y línea de firma. | Otro tamaño de página y texto centrado. |
| `credencial` | Una tarjeta de 100 × 70 mm por página. | La de rellenar desde un CSV en lote. |
| `boletin` | Cabecera y dos columnas que siguen en la página 2. | Una cadena de tres zonas, en dos páginas. |

Las seis se comprueban en CI: que abren, que se componen sin un solo aviso,
que traen sus fuentes y que cada variable que declaran se usa y tiene
ejemplo (`crates/galera-core/tests/plantillas.rs`). El PDF de cada una está
en `fixtures/plantillas/`, para mirar de un vistazo qué compone.

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
