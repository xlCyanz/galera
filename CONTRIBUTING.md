# Guía de contribución

Gracias por el interés en Galera. Este documento explica cómo trabajamos: flujo de ramas, formato de commits, qué debe cumplir un PR y cómo se organizan las tareas.

Galera lo desarrolla una sola persona con experiencia web y sin experiencia previa en Rust ni en apps de escritorio. Por eso las tareas son **pequeñas, verificables y autoexplicativas**: cuando una tarea toca un concepto nuevo de Rust o Tauri por primera vez, la issue incluye una nota que lo explica.

---

## 1. Antes de escribir código

1. **Lee [`guide.md`](guide.md)**: es la fuente de verdad del proyecto (alcance, fases, modelo, riesgos).
2. **Respeta los seis principios** del [README](README.md#principios-inviolables). No son negociables dentro de un PR. Si una tarea parece exigir romperlos, para y coméntalo en la issue.
3. **Busca una issue existente** antes de crear otra. Todo el trabajo planificado ya está en issues, agrupado por fase (milestone).
4. **No empieces una fase sin cerrar la anterior.** Cada fase termina con algo usable y tiene criterios de salida propios.

## 2. Entorno de desarrollo

```bash
# Rust estable + componentes
rustup toolchain install stable
rustup component add rustfmt clippy

# Revisión de instantáneas del código Typst generado
cargo install cargo-insta

# Frontend (Node 24 y pnpm 12; la versión exacta de pnpm la fija package.json)
pnpm install

# Comprobación completa (lo mismo que hace CI)
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
pnpm typecheck
pnpm test
pnpm build
```

Dependencias del sistema para Tauri: <https://tauri.app/start/prerequisites/>

## 3. Flujo de trabajo

```
issue  →  rama  →  commits  →  PR  →  revisión  →  squash merge  →  issue cerrada
```

### Ramas

Una rama por issue. Nombre: `<tipo>/<numero-issue>-<resumen-corto>`.

```
feat/12-codegen-rect
fix/48-cursor-desalineado
docs/7-readme-arquitectura
chore/3-workflow-ci
spike/51-ime-webview
```

Tipos: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `perf`, `spike`.

Nunca se hace push directo a `main`; está protegida.

### Commits

[Conventional Commits](https://www.conventionalcommits.org/), en inglés, en imperativo, asunto de 50 caracteres o menos.

```
<tipo>(<ámbito>): <asunto>

<cuerpo opcional: el porqué, no el qué>

Refs #12
```

Ámbitos habituales: `core`, `model`, `codegen`, `world`, `project`, `compile`, `layout`, `ops`, `snap`, `cli`, `tauri`, `ui`, `canvas`, `text`, `ci`, `docs`.

```
feat(codegen): emit place() wrapper for rect elements
fix(layout): use frame origin instead of page origin for el-ID boxes
test(codegen): add insta snapshots for escaped text
```

Un commit debe compilar y pasar las pruebas por sí solo. Si el trabajo es grande, divídelo en commits pequeños y ordenados, no en un commit gigante.

### Pull requests

- Un PR por issue. Si el PR crece más allá de la tarea, divídelo.
- Título con el mismo formato que el commit: `feat(codegen): emit place() wrapper for rect elements`.
- Rellena la plantilla completa: qué cambia, cómo probarlo, criterios de aceptación marcados, impacto en los principios.
- Enlaza la issue con `Closes #12` para que se cierre sola al fusionar.
- Los PR en curso se abren como **borrador**.
- Se fusiona con **squash merge**. La rama se borra automáticamente.

Un PR está listo cuando:

- [ ] CI en verde (`fmt`, `clippy -D warnings`, `test`, build del frontend).
- [ ] Todos los criterios de aceptación de la issue están marcados y son demostrables.
- [ ] Hay pruebas nuevas o actualizadas si cambió el comportamiento.
- [ ] Las instantáneas de `insta` revisadas a mano (`cargo insta review`), nunca aceptadas a ciegas.
- [ ] `docs/tareas.md` actualizado con el nuevo estado de la tarea.
- [ ] No se rompe ningún principio del README.

## 4. Formato de las tareas

Cada issue de tarea sigue esta forma (la plantilla la genera sola):

```markdown
### F<fase>-<número> — <título en infinitivo>
**Depende de:** F0-02, F0-03
**Archivos:** crates/galera-core/src/codegen.rs
**Descripción:** qué hay que hacer y por qué.
**Criterios de aceptación:**
- [ ] criterio verificable
- [ ] criterio verificable
**Cómo probarlo:** comando o pasos exactos.
**Estado:** pendiente | en curso | hecha
```

Reglas:

- Una tarea debe caber en una sesión de 1 a 3 horas. Si no cabe, pártela en dos issues.
- Los criterios de aceptación son **verificables**: un comando, una salida, un número. «Funciona bien» no es un criterio.
- «Cómo probarlo» tiene que ser copiable y pegable.

### Etiquetas

| Grupo | Etiquetas |
|---|---|
| Fase | `fase-0` … `fase-8` |
| Tipo | `tarea`, `bug`, `enhancement`, `spike`, `chore`, `documentation` |
| Área | `area:core`, `area:codegen`, `area:typst`, `area:layout`, `area:ops`, `area:cli`, `area:tauri`, `area:ui`, `area:canvas`, `area:texto`, `area:build`, `area:testing` |
| Prioridad | `p0-bloqueante`, `p1-alta`, `p2-normal` |
| Otras | `riesgo`, `rendimiento`, `accessibility`, `good first issue`, `blocked` |

## 5. Estilo de código

### Rust

- `cargo fmt` manda. No se discute formato en revisión.
- `clippy` sin avisos (`-D warnings`).
- Nada de `unwrap()` ni `expect()` en rutas de producción: devuelve `Result` con un error propio (`thiserror`). En pruebas sí se permiten.
- El uso de crates de Typst queda **aislado** en `world`, `compile` y `layout`. El resto del núcleo no importa `typst::*`.
- Versiones de los crates de Typst **fijadas** en `Cargo.toml` (`=0.x.y`), nunca con rangos.
- Documenta los módulos y las funciones públicas con `///` en español.

### TypeScript / React

- TypeScript estricto; nada de `any` sin un comentario que lo justifique.
- Componentes funcionales con hooks. Estado global en Zustand; estado local en el componente.
- La interfaz **nunca** renderiza texto del documento: solo controles, manejadores y guías.
- Las tareas de interfaz citan la sección de `docs/galera-design-brief.md` que implementan.

### Tipos TypeScript del modelo

El modelo vive en Rust. La interfaz **no define a mano** ningún tipo del modelo: los importa de `app/src/types/`, que se genera desde los structs de `galera-core` con [`ts-rs`](https://github.com/Aleph-Alpha/ts-rs).

```bash
cargo test -p galera-core export_bindings
```

- Se genera al ejecutar las pruebas del núcleo, así que `cargo test` también lo regenera. La carpeta de destino la fija `.cargo/config.toml`.
- Cada tipo exportado lleva `#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "…"))]`. `ts-rs` es solo dependencia de desarrollo: el núcleo que se distribuye no la usa.
- Si cambias el modelo, regenera y **sube los archivos generados en el mismo PR**. CI ejecuta las pruebas y falla si `app/src/types/` no coincide con lo que hay en el repositorio.
- No edites esos archivos: se sobrescriben. Una prueba de Vitest falla si un archivo escrito a mano vuelve a declarar un tipo generado.

### Pruebas

- Núcleo: `cargo test`, con instantáneas `insta` para el código Typst generado.
- Cualquier corrección de bug entra con una prueba que falle antes del arreglo.
- Interfaz: Vitest para lógica pura; no se testean píxeles.
- Rendimiento: `cargo bench -p galera-core` mide lo que cuesta una tecla —compilar y dibujar las páginas— desde cero y con el compilador guardado. Las mediciones se anotan en la issue, y las de la compilación en [docs/decisiones/compilacion-incremental.md](docs/decisiones/compilacion-incremental.md), con el documento y la máquina usados.

## 6. Reportar bugs y proponer ideas

- **Bug:** usa la plantilla de bug. Hace falta el JSON del documento (o uno mínimo que reproduzca), los pasos, el resultado esperado y el real, y la versión de Typst.
- **Mejora:** usa la plantilla de mejora. Di qué problema resuelve, no solo qué función quieres.
- **Vulnerabilidad:** no abras una issue, sigue [SECURITY.md](SECURITY.md).
- **Duda:** usa la plantilla de pregunta o las Discussions.

## 7. Decisiones técnicas

Si un PR cambia algo estructural (formato de archivo, forma del modelo, versión de Typst, límites entre módulos), escríbelo en la descripción del PR y añádelo al resumen de fin de fase en `docs/tareas.md`. Cuando la decisión tenga alternativas reales, abre antes una issue con la etiqueta `enhancement` y discútelo ahí.

## 8. Código de conducta

Al participar aceptas el [Código de conducta](CODE_OF_CONDUCT.md).
