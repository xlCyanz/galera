# Criterio de salida de la Fase 3

> **Estado: pendiente de la sesión a mano.** El análisis está, las issues de
> lo que faltaba están cerradas y hay una prueba que construye el documento
> entero a base de comandos —los mismos que manda la interfaz— y lo compara
> con el de referencia. Lo que queda es hacerlo **con las manos en la app** y
> guardar las capturas. Ver «[Cómo hacer la sesión](#cómo-hacer-la-sesión)».

El criterio de la Fase 3 es **construir el documento de ejemplo desde cero,
solo con la interfaz, sin editar el JSON a mano** ([#54](https://github.com/xlCyanz/galera/issues/54)).

## Qué documento

El brief de diseño (F1-13, [#29](https://github.com/xlCyanz/galera/issues/29))
todavía no está en el repositorio, así que el documento de referencia es el
**ejemplo de la sección 4 de [`guide.md`](../guide.md)**, que es
[`fixtures/informe.json`](../fixtures/informe.json) y ya tiene una prueba que
los compara. Lleva, en una página A4:

| Qué | Detalle |
|---|---|
| Título | «Informe anual 2026» |
| Fuentes | `Inter-Regular.ttf` e `Inter-Bold.ttf` |
| Imagen | `assets/logo.png`, con la clave `logo` |
| Variables | `nombre` = «Cooperativa Agrícola del Este» |
| Banda superior | Rectángulo azul `#1e40af`, 210 × 15 mm, en (0, 0) |
| Titular | Texto «Informe anual» **en negrita**, Inter 28 pt, 170 mm de ancho, alto automático |
| Logotipo | Imagen de 80 mm de ancho, alto automático |
| Bloque de código | `#table(columns: 2)[A][B]`, 170 × 40 mm |

## Qué se puede hacer hoy con la interfaz

| Parte del documento | ¿Desde la app? | Con qué |
|---|:--:|---|
| Banda azul (rectángulo, posición, tamaño, relleno) | ✅ | Herramienta `R` e inspector de formas ([#49](https://github.com/xlCyanz/galera/issues/49)) |
| Cuadro de texto, ancho y alto automático | ✅ | Herramienta `T` ([#43](https://github.com/xlCyanz/galera/issues/43)) |
| Fuente, tamaño, color y alineación del texto | ✅ | Inspector de texto ([#50](https://github.com/xlCyanz/galera/issues/50)) |
| Añadir las fuentes al proyecto | ✅ | Panel de fuentes ([#48](https://github.com/xlCyanz/galera/issues/48)) |
| Insertar la imagen y registrarla en `assets` | ✅ | Soltarla en el lienzo o herramienta `I` ([#44](https://github.com/xlCyanz/galera/issues/44)) |
| Colocar y medir todo (X, Y, ancho, alto, giro) | ✅ | Inspector ([#39](https://github.com/xlCyanz/galera/issues/39)) |
| Orden de capas, nombres, ocultar y bloquear | ✅ | Panel de capas ([#45](https://github.com/xlCyanz/galera/issues/45), [#46](https://github.com/xlCyanz/galera/issues/46)) |
| Guardar como carpeta o `.galera` | ✅ | ⌘S y «Guardar como…» ([#51](https://github.com/xlCyanz/galera/issues/51)) |
| Empezar un proyecto nuevo | ✅ | «Nuevo proyecto…» / «Nuevo .galera…» ([#155](https://github.com/xlCyanz/galera/issues/155)) |
| Título del documento | ✅ | Campo «Título» del inspector, sin selección ([#156](https://github.com/xlCyanz/galera/issues/156)) |
| Bloque de código | ✅ | Herramienta `C` y campo «Código Typst» del inspector ([#157](https://github.com/xlCyanz/galera/issues/157)) |
| Variables del documento | ✅ | Pestaña «Variables» ([#158](https://github.com/xlCyanz/galera/issues/158)) |
| Ids cortos (`r1`, `t1`…) | ✅ | Doble clic en el id, en el inspector ([#159](https://github.com/xlCyanz/galera/issues/159)) |
| Negrita dentro del texto | ✅ | ⌘B y la barra de formato, ya en la Fase 4 ([#62](https://github.com/xlCyanz/galera/issues/62)) |

Es decir: **el documento se construye entero desde la app**. Los cinco huecos
que encontró este análisis están cerrados, y la negrita —lo único que faltaba
cuando se escribió— llegó con la Fase 4.

## La prueba que lo comprueba sola

`crates/galera-core/tests/criterio_fase_3.rs` parte de un proyecto vacío
—el que hace «Nuevo proyecto…»— y llega al documento de referencia aplicando
**solo comandos**: los mismos que mandan el panel de fuentes, el de
variables, el lienzo y el inspector. Cada paso dice con qué gesto se hace.
Al final compara el documento resultante con `fixtures/informe.json`, lo
guarda, lo vuelve a abrir y lo compila.

Eso prueba una cosa concreta: **nada de este documento se puede poner solo
escribiendo JSON**. La interfaz no toca el documento por su cuenta (principio
1), así que si la secuencia de comandos llega al resultado, desde la
aplicación se llega también.

Lo que la prueba **no** dice es si esos gestos se encuentran y se entienden:
si el campo está donde se busca, si el diálogo dice lo que tiene que decir,
si hace falta adivinar algo. Para eso está la sesión a mano, que es lo que
queda.

No se guarda un `fixtures/fase3.json` aparte: sería una copia exacta de
`informe.json`, y lo que interesa —que el resultado es idéntico al de
referencia— ya lo comprueba la prueba en cada `cargo test`.

## Cómo hacer la sesión

Con la app abierta (`pnpm tauri dev`), y guardando una captura en cada paso en
`docs/capturas/fase-3/`:

1. **Proyecto vacío.** **Nuevo proyecto…** (⌘N) y elegir una carpeta vacía:
   nace con una página A4, `fonts/` y `assets/`, y queda abierto.
2. **Fuentes.** Pestaña **Fuentes** → **Añadir…** → `fixtures/fonts/Inter-Regular.ttf`;
   repetir con `Inter-Bold.ttf`. Se copian a `fonts/` del proyecto.
3. **Banda azul.** Herramienta `R`, arrastrar cualquier rectángulo y, en el
   inspector, poner X 0, Y 0, An 210, Al 15 y relleno `#1e40af` (sin borde).
4. **Titular.** Herramienta `T`, arrastrar un ancho, y en el inspector: X 20,
   Y 30, An 170; fuente Inter, 28 pt, color `#1F2733`, alineado a la
   izquierda. Doble clic para escribir «Informe anual», seleccionarlo entero
   y ⌘B para la negrita.
5. **Bloque de código.** Herramienta `C`, arrastrar su caja y, en el
   inspector, escribir `#table(columns: 2)[A][B]`; medidas X 20, Y 200,
   An 170, Al 40.
6. **Logotipo.** Arrastrar `fixtures/assets/logo.png` sobre el lienzo (o `I` +
   clic) y dejarlo en X 20, Y 60, An 80, alto automático.
7. **Ids.** Doble clic en el id de cada elemento en el inspector para
   dejarlos como el ejemplo (`r1`, `t1`, `i1`, `c1`), y el título del
   documento en el campo «Título», sin selección.
8. **Guardar.** ⌘S, y **Guardar como .galera…** para comprobar que el archivo
   se abre luego en otro sitio.
9. **Comparar.** Comparar el `document.json` que queda con
   `fixtures/informe.json`. Tiene que salir idéntico: es lo que deja la misma
   secuencia de comandos en `tests/criterio_fase_3.rs`. Lo que salga distinto
   es un hallazgo, y va a una issue nueva.

## Qué queda para cerrar #54

- [x] Que el documento se construya entero sin escribir JSON
      (`tests/criterio_fase_3.rs`).
- [x] Comparar el resultado con el de referencia: lo hace esa misma prueba,
      contra `fixtures/informe.json`.
- [ ] Hacer la sesión con las manos y guardar las capturas en
      `docs/capturas/fase-3/`, anotando aquí lo que cueste encontrar.
- [x] Abrir una issue por cada cosa que obligó a tocar el JSON
      ([#155](https://github.com/xlCyanz/galera/issues/155),
      [#156](https://github.com/xlCyanz/galera/issues/156),
      [#157](https://github.com/xlCyanz/galera/issues/157),
      [#158](https://github.com/xlCyanz/galera/issues/158),
      [#159](https://github.com/xlCyanz/galera/issues/159)).
