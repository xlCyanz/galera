# Fixtures

Documentos de ejemplo que sirven de banco de pruebas para todo el proyecto. Comparten carpeta de proyecto: las rutas de fuentes e imágenes que declaran (`fonts/…`, `assets/…`) son relativas a esta carpeta.

| Fixture | Qué cubre |
|---|---|
| `informe.json` | El ejemplo de la sección 4 de [`guide.md`](../guide.md), **idéntico**. Una prueba lo compara con la guía. |
| `rectangulo.json` | Relleno y borde, sin ninguno, solo borde, rotación, alto automático, color con transparencia. |
| `elipse.json` | Relleno, solo borde, rotación negativa, color corto (`#abc`). |
| `linea.json` | Horizontal, hacia atrás (deltas negativos), rotada. |
| `texto.json` | Las cuatro alineaciones, alto fijo, saltos de línea y de párrafo, varios tramos. |
| `imagen.json` | PNG, JPEG y SVG; proporción original, alto fijo, rotación. |
| `codigo.json` | Tabla en varias líneas con comillas, alto fijo, bloque vacío. |
| `escape.json` | Todo lo que tiene que escaparse: caracteres de marcado, marcadores de línea, comentarios, enlaces, y comillas en el título y en el nombre de fuente. |
| `multipagina.json` | Cinco páginas: mismo tamaño seguido, apaisada, en pulgadas, vacía. |

`assets/` tiene imágenes de 1×1 px en los tres formatos. `fonts/` todavía no existe: ver más abajo.

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

## Fuentes

`informe.json`, `texto.json` y `escape.json` declaran la fuente **Inter** en `fonts/`, que el repositorio todavía no incluye. Las instantáneas no la necesitan —son código generado, no compilación—, pero compilar esos fixtures a PDF sí:

```bash
cargo run -p galera-cli -- fixtures/informe.json -o salida.pdf
# error: … el documento declara la fuente "fonts/Inter-Regular.ttf", pero no está en la carpeta del proyecto
```

Resolverlo es el criterio de salida de la Fase 0 y está pendiente de decidir.
