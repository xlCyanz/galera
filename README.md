<p align="center">
  <img src="docs/assets/banner.jpeg" alt="Galera — Design documents visually. Export pixel-perfect Typst." width="100%">
</p>

<p align="center">
  <a href="https://github.com/xlCyanz/galera/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/xlCyanz/galera/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://github.com/xlCyanz/galera/milestone/1"><img alt="Fase" src="https://img.shields.io/badge/fase-0%20%C2%B7%20n%C3%BAcleo%20por%20terminal-0E4429"></a>
  <a href="https://github.com/xlCyanz/galera/issues"><img alt="Tareas" src="https://img.shields.io/github/issues/xlCyanz/galera?label=tareas%20abiertas"></a>
  <img alt="Rust" src="https://img.shields.io/badge/rust-1.85%2B-B7410E?logo=rust&logoColor=white">
  <img alt="Tauri" src="https://img.shields.io/badge/tauri-2-24C8DB?logo=tauri&logoColor=white">
  <a href="LICENSE"><img alt="Licencia" src="https://img.shields.io/badge/licencia-MIT-1F2733"></a>
</p>

# Galera

Hay dos maneras de sacar un documento bien hecho, y ninguna es cómoda.

Puedes abrirlo en una herramienta visual, colocar las cosas con el ratón y aceptar lo que salga: tipografía mediocre, saltos de línea caprichosos y un PDF que nunca termina de parecerse a lo que tenías en pantalla. O puedes escribirlo en LaTeX o en Typst, conseguir una composición impecable y trabajar a ciegas, compilando cada pocos minutos para ver qué has hecho.

**Galera es la tercera vía.** Colocas los elementos sobre la página arrastrando, como en Canva, pero lo que ves en el lienzo **es** el render del compilador de Typst. No es una previsualización ni una aproximación del navegador: es el mismo documento compilado que sale al exportar.

```
  tu documento              galera-core                 salida
  ┌──────────┐    codegen   ┌──────────┐   compilador   ┌─────┐
  │  JSON    │ ───────────► │  .typ    │ ─────────────► │ PDF │
  └──────────┘              └──────────┘    de Typst    │ SVG │
       ▲                                     │          │ PNG │
       │  comandos de edición                │          └─────┘
       │                                     ▼
  ┌──────────┐    el mismo render que se exporta
  │  lienzo  │ ◄──────────────────────────────
  └──────────┘
```

Sirve para informes, facturas, certificados, carteles y CVs. El documento se guarda como un modelo JSON propio; Typst es únicamente el formato de salida.

**Por qué importa que sea Typst quien dibuja.** Si el editor pintara el texto con el motor del navegador, tendrías dos motores de composición discrepando: el de pantalla y el del PDF. Ahí nacen los saltos de línea que se mueven al exportar y los cuadros que dejan de cuadrar. En Galera solo hay un motor. La interfaz dibuja encima los manejadores, las guías y el cursor, y nada más.

**Y el cursor de texto también.** Su posición sale de las coordenadas de glifos que devuelve Typst, no de una medición aparte. Es más difícil de construir y es justo lo que evita que el editor y el PDF se separen.

> **Estado:** desarrollo temprano, Fase 0 de 8. Todavía no hay binarios publicados. El plan completo está en [`guide.md`](guide.md) y el avance tarea a tarea en [`docs/tareas.md`](docs/tareas.md).

---

## Principios inviolables

Ninguna tarea, PR o refactor puede romper estos seis puntos. Si una tarea parece exigirlo, hay que parar y discutirlo en una issue.

1. **El JSON es la fuente de verdad.** Typst es un formato de salida. El editor nunca parsea ni modifica código Typst escrito a mano (salvo el bloque de *código personalizado*, que se trata como caja opaca).
2. **Typst dibuja todo lo que el usuario ve.** El lienzo muestra el render de Typst. Nunca se dibuja texto del documento con el motor del navegador.
3. **Typst mide todo.** Tamaños, posiciones de glifos, cursor y detección de clics salen del layout que devuelve Typst.
4. **Las fuentes viajan con el documento.** Cada proyecto empaqueta sus archivos de fuente; no se depende de las fuentes instaladas.
5. **La lógica vive en el núcleo Rust.** Modelo, codegen, compilación, layout, alineación y guías viven en `galera-core`, independiente de la interfaz.
6. **Todo texto del usuario se escapa** antes de insertarse en Typst: `#`, `*`, `_`, `$`, `@`, `<`, `>`, `\`, `` ` ``, `[`, `]`.

---

## Arquitectura

```
┌──────────────────────── App Tauri ────────────────────────┐
│  Interfaz (webview)                                        │
│  React + TypeScript + Zustand                              │
│  - Paneles: capas, recursos, inspector, código             │
│  - Lienzo: SVG de Typst + capa de controles                │
│             │  comandos Tauri (invoke / eventos)           │
│  ───────────┼──────────────────────────────────────────── │
│  Backend Tauri (Rust)                                      │
│             ▼                                              │
│  galera-core (crate propio)                                │
│  - model:    documento, páginas, elementos (serde)         │
│  - codegen:  JSON → código Typst                           │
│  - world:    implementación de typst::World                │
│  - compile:  compilación incremental → SVG / PDF / PNG     │
│  - layout:   posiciones, tamaños, glifos, hit-testing      │
│  - ops:      comandos de edición + historial (undo/redo)   │
│  - snap:     guías de alineación                           │
└────────────────────────────────────────────────────────────┘
```

### Estructura del repositorio

```
galera/
├── crates/
│   ├── galera-core/     # núcleo, sin dependencias de Tauri
│   └── galera-cli/      # herramienta de terminal: JSON → PDF (pruebas)
├── app/
│   ├── src-tauri/       # backend Tauri, comandos que llaman a galera-core
│   └── src/             # interfaz React
├── fixtures/            # documentos JSON de ejemplo y PDF de referencia
├── docs/                # brief de diseño, resumen del proyecto, tareas
└── guide.md             # resumen del proyecto (fuente de verdad de planificación)
```

### Tecnologías

| Área | Elección |
|---|---|
| Núcleo | Rust, crates `typst`, `typst-svg`, `typst-pdf`, `typst-render`, `serde`, `serde_json` |
| Escritorio | Tauri 2 |
| Interfaz | React, TypeScript, Vite, Zustand |
| Lienzo | SVG de Typst como fondo + capa de controles para manejadores y guías |
| Editor de código | CodeMirror 6 |
| Pruebas | `cargo test`, instantáneas con `insta`, Vitest en la interfaz |

> Antes de usar cualquier crate de Typst, verifica su versión y su API en crates.io y en el repositorio oficial: cambian con frecuencia.

---

## Requisitos

| Herramienta | Versión mínima |
|---|---|
| Rust (stable) | 1.80 |
| Node.js | 20 LTS |
| pnpm | 9 |
| Xcode Command Line Tools (macOS) | — |

Dependencias del sistema para Tauri: <https://tauri.app/start/prerequisites/>

## Puesta en marcha

```bash
git clone https://github.com/xlCyanz/galera.git
cd galera

# Núcleo en Rust
cargo build --workspace
cargo test --workspace

# CLI: JSON → PDF (disponible desde la Fase 0)
cargo run -p galera-cli -- fixtures/informe.json -o salida.pdf

# App de escritorio (disponible desde la Fase 1)
pnpm install
pnpm tauri dev
```

## Modelo de documento

El documento es un JSON versionado. Ejemplo mínimo:

```json
{
  "version": 1,
  "meta": { "title": "Informe anual 2026" },
  "fonts": ["fonts/Inter-Regular.ttf"],
  "assets": { "logo": "assets/logo.png" },
  "variables": { "nombre": "Cooperativa Agrícola del Este" },
  "pages": [
    {
      "id": "p1",
      "size": { "width": 210, "height": 297, "unit": "mm" },
      "elements": [
        { "id": "t1", "type": "text", "x": 20, "y": 30, "w": 170, "h": null,
          "rotation": 0,
          "content": [{ "text": "Informe anual", "bold": true }],
          "style": { "font": "Inter", "size": 28, "color": "#1F2733",
                     "align": "left", "leading": 0.65 } }
      ]
    }
  ]
}
```

- Tipos de elemento: `text`, `rect`, `ellipse`, `line`, `image`, `code`. Después: `group`, `table`, `flow`.
- `"h": null` en texto significa altura automática, medida por Typst.
- El orden del arreglo `elements` es el orden de capas (el último queda encima).
- Cada elemento se emite con `place(top + left, dx, dy)` y una etiqueta `<el-ID>` para localizarlo en el layout compilado.
- Un proyecto es una carpeta o zip `.galera` con `document.json`, `fonts/` y `assets/`.

---

## Hoja de ruta

| Fase | Objetivo | Estado |
|---|---|---|
| [Fase 0](../../milestone/1) | Núcleo por terminal: JSON entra, PDF sale | En curso |
| [Fase 1](../../milestone/2) | Ventana y vista fiel | Pendiente |
| [Fase 2](../../milestone/3) | Layout y selección | Pendiente |
| [Fase 3](../../milestone/4) | Creación de elementos y paneles | Pendiente |
| [Fase 4](../../milestone/5) | Edición de texto de alta fidelidad | Pendiente |
| [Fase 5](../../milestone/6) | Productividad | Pendiente |
| [Fase 6](../../milestone/7) | Plantillas y variables | Pendiente |
| [Fase 7](../../milestone/8) | Texto que fluye y tablas | Pendiente |
| [Fase 8](../../milestone/9) | Pulido y distribución | Pendiente |

Estado detallado tarea por tarea: [`docs/tareas.md`](docs/tareas.md).

## Fuera de alcance por ahora

Edición colaborativa en tiempo real · importar Word/Canva/PDF · abrir `.typ` escritos a mano · versión web o móvil · cuentas de usuario o nube.

---

## Contribuir

Lee [CONTRIBUTING.md](CONTRIBUTING.md) antes de abrir un PR. Resumen:

- Una issue por tarea, una rama por issue, un PR por rama.
- Commits en formato [Conventional Commits](https://www.conventionalcommits.org/).
- `cargo fmt`, `cargo clippy -- -D warnings` y `cargo test` en verde antes de pedir revisión.
- Ningún PR puede romper los seis principios de arriba.

También: [Código de conducta](CODE_OF_CONDUCT.md) · [Política de seguridad](SECURITY.md)

## Licencia

[MIT](LICENSE).
