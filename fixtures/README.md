# Fixtures

Documentos de ejemplo que sirven de banco de pruebas para todo el proyecto. Comparten carpeta de proyecto: las rutas de fuentes e imágenes que declaran (`fonts/…`, `assets/…`) son relativas a esta carpeta.

| Fixture | Qué cubre |
|---|---|
| `informe.json` | El ejemplo de la sección 4 de [`guide.md`](../guide.md), **idéntico**. Una prueba lo compara con la guía. |
| `document.json` | Copia exacta de `informe.json`, para que `fixtures/` se pueda abrir como proyecto desde la app. Una prueba comprueba que siguen iguales, y no tiene instantánea propia. |
| `rectangulo.json` | Relleno y borde, sin ninguno, solo borde, rotación, alto automático, color con transparencia. |
| `elipse.json` | Relleno, solo borde, rotación negativa, color corto (`#abc`). |
| `linea.json` | Horizontal, hacia atrás (deltas negativos), rotada, y los tres estilos de trazo: rayas, puntos y raya-punto. |
| `texto.json` | Las cuatro alineaciones, alto fijo, saltos de línea y de párrafo, varios tramos, espacio entre párrafos. |
| `imagen.json` | PNG, JPEG y SVG; proporción original, alto fijo, rotación. |
| `codigo.json` | Tabla en varias líneas con comillas, alto fijo, bloque vacío. |
| `escape.json` | Todo lo que tiene que escaparse: caracteres de marcado, marcadores de línea, comentarios, enlaces y comillas en el título. Las comillas en nombres de fuente se prueban en las pruebas unitarias de `codegen`: una familia que no existe ya no pasa la validación. |
| `capas.json` | Lo del panel de capas: un fondo con nombre y bloqueado, un rectángulo y una línea ocultos (que no se emiten), un texto con nombre y una elipse con `hidden: false`. |
| `multipagina.json` | Cinco páginas: mismo tamaño seguido, apaisada, en pulgadas, vacía. |
| `tabla.json` | Columnas automáticas, proporcionales y fijas; celdas combinadas por filas y por columnas; fondos por fila y por celda; alineación por celda; una tabla sin bordes ni relleno; y contenido con caracteres de marcado, que se escapan. |
| `flujo.json` | Un texto que fluye por tres zonas en dos páginas: dos con alto fijo y una con alto automático, con un tramo en negrita a caballo entre zonas. |

`assets/` tiene imágenes de 1×1 px en los tres formatos, y `fonts/`, las fuentes: ver más abajo.

## Instantáneas

Cada fixture tiene una **instantánea** del código Typst que genera Galera, en `crates/galera-core/tests/snapshots/`. La prueba que las compara está en `crates/galera-core/tests/fixtures.rs`.

Si un cambio en el codegen altera el código de cualquier fixture, `cargo test` falla y enseña el diff. Eso es lo que se quiere: ningún cambio en lo que recibe el compilador pasa sin que alguien lo vea.

### Revisar un cambio

```bash
cargo install cargo-insta            # una vez

cargo insta test -p galera-core      # ejecuta las pruebas y guarda los cambios pendientes
cargo insta review                   # los enseña uno a uno: a (aceptar), r (rechazar), s (saltar)
```

**Nunca se aceptan a ciegas.** Cada diff es un cambio en el código que compila Typst; hay que leerlo y entender por qué cambió. `cargo insta accept` sin revisar está prohibido en CONTRIBUTING.

Sin `cargo-insta`, `cargo test` deja los cambios en archivos `.snap.new` junto a los `.snap`; se pueden comparar a mano y renombrar.

### Añadir un fixture

1. Crear `fixtures/nombre.json`.
2. Añadir `"nombre"` a la lista `FIXTURES` de `crates/galera-core/tests/fixtures.rs`. Si se olvida, `every_fixture_has_a_snapshot` falla.
3. `cargo insta test -p galera-core` y `cargo insta review` para crear su instantánea.
4. Añadirlo a la tabla de arriba.

## Los PDF de las plantillas

`plantillas/` guarda el PDF que compone cada plantilla de `templates/`, uno
por carpeta y con su mismo nombre. Están para **mirarlos**: qué enseña cada
plantilla recién abierta, sin tener que abrir la aplicación.

No se comparan byte a byte —dos compilaciones de Typst no dan el mismo
archivo—, así que lo que protege a las plantillas es
`crates/galera-core/tests/plantillas.rs`, que las abre, las compone y
comprueba que no avisan de nada. Se rehacen con:

```bash
for t in boletin carta certificado credencial factura informe; do
  cargo run -p galera-cli -- templates/$t -o fixtures/plantillas/$t.pdf
done
```

## Fuentes

`fonts/` contiene **Inter 4.1**, las dos caras que declaran los fixtures:

| Archivo | Tamaño |
|---|---|
| `Inter-Regular.ttf` | 411 640 B |
| `Inter-Bold.ttf` | 420 428 B |
| `Inter-LICENSE.txt` | 4 380 B |

Procedencia: `extras/ttf/` del archivo `Inter-4.1.zip` de la publicación oficial [v4.1 de rsms/inter](https://github.com/rsms/inter/releases/tag/v4.1) (SHA-256 del zip `9883fdd4a49d4fb66bd8177ba6625ef9a64aa45899767dde3d36aa425756b11e`). Licencia: SIL Open Font License 1.1, que permite redistribuirla junto con su licencia.

Con ellas, todos los fixtures compilan a PDF:

```bash
cargo run -p galera-cli -- fixtures/informe.json -o salida.pdf
```

Y la carpeta entera se abre desde la app con **Abrir proyecto…**, gracias a `document.json`.

Inter no tiene glifos de emoji ni de escrituras CJK. Galera nunca recurre a fuentes del sistema (principio 4), así que en `escape.json` esos caracteres salen como cuadrados vacíos. Es lo esperado: un documento que los necesite tiene que traer una fuente que los tenga.

`assets/logo.png` es un logotipo de ejemplo de 400×400 px generado para `informe.json`.
