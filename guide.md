# Galera — resumen del proyecto para planificación con IA

Este documento describe el proyecto completo. Úsalo como fuente de verdad para generar la lista de tareas, ejecutarlas en orden y comprobar cada una antes de pasar a la siguiente.

---

## 1. Qué se construye

**Galera** es una aplicación de escritorio para diseñar documentos (informes, facturas, certificados, carteles, CVs) colocando elementos sobre una página, como en Canva. El documento se guarda como un modelo JSON propio, se traduce a código Typst y se compila con el compilador oficial de Typst para exportar PDF.

**Objetivo central: alta fidelidad.** Lo que el usuario ve en el lienzo debe ser exactamente lo que se exporta. Todo el diseño técnico gira alrededor de esto.

**Contexto del desarrollador:** una sola persona, con experiencia en desarrollo web y sin experiencia previa en Rust ni en apps de escritorio. Las tareas deben ser pequeñas, verificables y explicar lo necesario de Rust y Tauri cuando aparezca por primera vez.

---

## 2. Principios que ninguna tarea puede romper

1. **El JSON es la fuente de verdad.** Typst es un formato de salida. El editor nunca parsea ni modifica código Typst escrito a mano (salvo el bloque de "código personalizado", que se trata como caja opaca).
2. **Typst dibuja todo lo que el usuario ve.** El lienzo muestra el render de Typst. La interfaz solo dibuja controles encima: manejadores, guías, cursor, selección. Nunca se dibuja texto del documento con el motor del navegador.
3. **Typst mide todo.** Tamaños de cajas, posiciones de glifos, cursor y detección de clics se calculan con el layout que devuelve Typst.
4. **Las fuentes viajan con el documento.** Cada proyecto empaqueta sus archivos de fuente; no se depende de las fuentes instaladas.
5. **La lógica vive en el núcleo Rust.** Modelo, generación de Typst, compilación, layout, alineación y guías están en un crate independiente de la interfaz, reutilizable después en Swift (macOS) o WASM (web).
6. **Todo texto del usuario se escapa** antes de insertarse en Typst (`#`, `*`, `_`, `$`, `@`, `<`, `>`, `\`, `` ` ``, `[`, `]`).

---

## 3. Arquitectura

```
┌──────────────────────── App Tauri ────────────────────────┐
│  Interfaz (webview)                                        │
│  React + TypeScript + Zustand                              │
│  - Paneles: capas, recursos, inspector, código             │
│  - Lienzo: muestra SVG de Typst + capa de controles        │
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

**Estructura del repositorio**

```
galera/
├── crates/
│   ├── galera-core/     # núcleo, sin dependencias de Tauri
│   └── galera-cli/      # herramienta de terminal: JSON → PDF (pruebas)
├── app/
│   ├── src-tauri/       # backend Tauri, comandos que llaman a galera-core
│   └── src/             # interfaz React
├── fixtures/            # documentos JSON de ejemplo y PDF de referencia
└── docs/
    ├── galera-design-brief.md
    └── galera-resumen-proyecto.md
```

**Tecnologías**

| Área | Elección |
|---|---|
| Núcleo | Rust, crates `typst`, `typst-svg`, `typst-pdf`, `typst-render`, `serde`, `serde_json` |
| Escritorio | Tauri 2 |
| Interfaz | React, TypeScript, Vite, Zustand |
| Lienzo | SVG de Typst como fondo + capa de controles (SVG o Konva, solo para manejadores y guías) |
| Editor de código | CodeMirror 6 (panel de código y bloques personalizados) |
| Pruebas | `cargo test`, pruebas de instantánea con `insta`, Vitest en la interfaz |

Antes de usar cualquier crate de Typst, verificar su versión actual y su API en crates.io y en el repositorio oficial, porque cambian con frecuencia.

---

## 4. Modelo de documento (versión inicial)

```json
{
  "version": 1,
  "meta": { "title": "Informe anual 2026" },
  "fonts": ["fonts/Inter-Regular.ttf", "fonts/Inter-Bold.ttf"],
  "assets": { "logo": "assets/logo.png" },
  "variables": { "nombre": "Cooperativa Agrícola del Este" },
  "pages": [
    {
      "id": "p1",
      "size": { "width": 210, "height": 297, "unit": "mm" },
      "elements": [
        { "id": "r1", "type": "rect", "x": 0, "y": 0, "w": 210, "h": 15,
          "rotation": 0, "fill": "#1e40af", "stroke": null, "radius": 0 },
        { "id": "t1", "type": "text", "x": 20, "y": 30, "w": 170, "h": null,
          "rotation": 0,
          "content": [ { "text": "Informe anual", "bold": true } ],
          "style": { "font": "Inter", "size": 28, "color": "#1F2733",
                     "align": "left", "leading": 0.65 } },
        { "id": "i1", "type": "image", "x": 20, "y": 60, "w": 80, "h": null,
          "rotation": 0, "asset": "logo" },
        { "id": "c1", "type": "code", "x": 20, "y": 200, "w": 170, "h": 40,
          "source": "#table(columns: 2)[A][B]" }
      ]
    }
  ]
}
```

- Tipos de elemento: `text`, `rect`, `ellipse`, `line`, `image`, `code`. Más adelante: `group`, `table`, `flow` (texto que fluye entre páginas).
- `h: null` en texto significa altura automática, medida por Typst.
- El orden del arreglo `elements` es el orden de capas (el último queda encima).
- Cada elemento se genera en Typst con `place(top + left, dx, dy)` y se marca con una etiqueta `<el-ID>` para poder localizarlo en el layout compilado.
- El formato de archivo del proyecto es una carpeta o un zip `.galera` con `document.json`, `fonts/` y `assets/`.

---

## 5. Fases e hitos

Cada fase termina con algo usable. No empezar una fase sin cumplir los criterios de la anterior.

### Fase 0 — Núcleo por terminal
Objetivo: JSON entra, PDF sale, sin interfaz.
- Crear el workspace de Cargo con `galera-core` y `galera-cli`.
- Definir el modelo con `serde` y validación básica.
- Implementar `codegen` para rect, ellipse, line, text (sin formato) e image.
- Implementar `World` de Typst con fuentes y assets cargados desde la carpeta del proyecto.
- Compilar a PDF y SVG.
- Función de escape de texto con pruebas.

**Criterios:** `galera-cli fixtures/informe.json -o salida.pdf` genera un PDF correcto; las pruebas de instantánea del código generado pasan; un texto con `#*_$@` no rompe la compilación.

### Fase 1 — Ventana y vista fiel
Objetivo: ver el documento renderizado por Typst dentro de la app.
- Crear la app Tauri 2 con React y conectar `galera-core`.
- Comandos: abrir proyecto, compilar, obtener SVG de una página, exportar PDF.
- Lienzo con la página centrada, zoom, desplazamiento y reglas en mm.
- Compilación en segundo plano sin bloquear la interfaz; barra de estado con tiempo y errores.

**Criterios:** abrir un proyecto muestra el SVG idéntico al PDF exportado; zoom del 25 % al 800 % nítido; un error de compilación se muestra con su mensaje.

### Fase 2 — Layout y selección
Objetivo: seleccionar y transformar elementos con medidas reales.
- Módulo `layout`: a partir del documento compilado, devolver la caja real de cada elemento usando las etiquetas `<el-ID>`.
- Hit-testing: clic en el lienzo → id del elemento.
- Capa de controles: contorno, 8 manejadores y rotación.
- Mover, redimensionar y rotar: durante el arrastre se desplaza la imagen ya renderizada; al soltar se envía el comando y se recompila.
- Módulo `ops` con comandos y deshacer/rehacer.
- Inspector con posición, tamaño y rotación editables.

**Criterios:** la caja de selección coincide exactamente con el contenido renderizado; mover 100 veces y deshacer 100 veces deja el documento igual que al inicio.

### Fase 3 — Creación de elementos y paneles
- Riel de herramientas: crear texto, rectángulo, elipse, línea, imagen (incluido arrastrar desde el sistema).
- Panel de capas: reordenar, ocultar, bloquear, renombrar.
- Panel de recursos: subir fuentes e imágenes al proyecto.
- Inspector completo por tipo de elemento (relleno, borde, radio, fuente, tamaño, color, alineación).
- Guardar y abrir `.galera`; guardado automático.
- Atajos de teclado del brief de diseño.

**Criterios:** se puede crear el documento de ejemplo del brief desde cero sin tocar el JSON.

### Fase 4 — Edición de texto de alta fidelidad
La fase más delicada. Hacer primero una prueba aislada antes de integrarla.
- Campo invisible que captura teclado e IME (acentos, emojis, pegar).
- Recompilación en cada pulsación con compilación incremental.
- Cursor y selección de texto calculados con las posiciones de glifos de Typst.
- Clic y arrastre dentro del texto para mover el cursor y seleccionar.
- Formato: negrita, cursiva, subrayado, color, enlaces, listas.
- Aviso de desbordamiento cuando el texto no cabe en una caja de altura fija.

**Criterios:** escribir un párrafo de 500 caracteres se siente fluido (objetivo: menos de 50 ms entre tecla y render en un documento de 5 páginas); el cursor nunca queda desalineado del texto; los cortes de línea en pantalla son idénticos al PDF.

### Fase 5 — Productividad
- Guías inteligentes y ajuste a bordes, centros y márgenes (módulo `snap`).
- Multiselección, agrupar, alinear y distribuir.
- Varias páginas: añadir, duplicar, reordenar, eliminar.
- Copiar y pegar entre documentos.
- Panel de código Typst en solo lectura con el elemento seleccionado resaltado.
- Bloque de código personalizado editable con CodeMirror.

### Fase 6 — Plantillas y variables
- Variables en el texto (fichas `{{nombre}}`) y panel de variables.
- Galería de plantillas (las seis del brief).
- Generación en lote desde CSV → varios PDF o un PDF combinado.
- Exportar a PDF, SVG, PNG y `.typ`.

### Fase 7 — Texto que fluye (diferenciador)
- Elemento `flow`: zonas de texto enlazadas que continúan entre páginas usando el flujo de Typst.
- Tablas editables.

### Fase 8 — Pulido y distribución
- Modo oscuro de la interfaz.
- Accesibilidad según el brief (foco, navegación por teclado).
- Pruebas de rendimiento con documentos de 50 páginas.
- Firma y empaquetado para macOS (y Windows si aplica).

---

## 6. Diseño de la interfaz

Seguir `docs/galera-design-brief.md` para colores, tipografía, estructura de pantalla, estados y textos. Las tareas de interfaz deben citar la sección del brief que implementan.

---

## 7. Fuera de alcance (por ahora)

- Edición colaborativa en tiempo real.
- Importar documentos de Word, Canva o PDF.
- Abrir y editar archivos `.typ` escritos a mano.
- Versión web o móvil (el núcleo queda preparado, pero no se construye).
- Cuentas de usuario o almacenamiento en la nube.

---

## 8. Riesgos conocidos

| Riesgo | Mitigación |
|---|---|
| La API de los crates de Typst cambia entre versiones | Fijar versiones en `Cargo.toml`; aislar el uso de Typst dentro de `world`, `compile` y `layout` |
| Recompilar en cada tecla es lento en documentos grandes | Compilación incremental, recompilar solo la página afectada si es posible, medir desde la fase 4 |
| Relacionar el layout compilado con elementos del JSON | Etiquetas `<el-ID>` en el código generado y pruebas específicas |
| Entrada de texto con IME en el webview | Prueba aislada al inicio de la fase 4 |
| Curva de aprendizaje de Rust | Tareas pequeñas con explicación de conceptos nuevos (ownership, traits, `Result`) |

---

## 9. Instrucciones para la IA que genere las tareas

**Cómo crear la lista:**
- Genera las tareas fase por fase. Completa y verifica una fase antes de detallar la siguiente.
- Cada tarea debe poder terminarse en una sesión de 1 a 3 horas.
- Si una tarea toca Rust o Tauri por primera vez en un concepto, incluye una nota breve explicándolo.

**Formato de cada tarea:**

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

**Al ejecutar tareas:**
- Trabaja una tarea a la vez y muestra el resultado de las pruebas antes de marcarla como hecha.
- No rompas los principios de la sección 2. Si una tarea parece requerirlo, detente y pregunta.
- Si encuentras que una API de Typst no funciona como se describe aquí, consulta la documentación actual, ajusta la tarea y anota el cambio.
- Mantén actualizado un archivo `docs/tareas.md` con el estado de todas las tareas.
- Al terminar cada fase, resume qué se hizo, qué quedó pendiente y cualquier decisión técnica nueva.
