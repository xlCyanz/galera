# Estado de las tareas

Fuente de verdad del avance del proyecto. Cada tarea tiene su issue en GitHub con la descripción completa, los criterios de aceptación y cómo probarla.

**Este archivo se actualiza en el mismo PR que completa la tarea.** Estados: ⬜ `pendiente` · 🟡 `en curso` · ✅ `hecha`.

| Fase | Tareas | Hechas |
|---|---|---|
| [Fase 0 — Núcleo por terminal](https://github.com/xlCyanz/galera/milestone/1) | 16 | 16 |
| [Fase 1 — Ventana y vista fiel](https://github.com/xlCyanz/galera/milestone/2) | 13 | 12 |
| [Fase 2 — Layout y selección](https://github.com/xlCyanz/galera/milestone/3) | 11 | 11 |
| [Fase 3 — Creación de elementos y paneles](https://github.com/xlCyanz/galera/milestone/4) | 14 | 13 |
| [Fase 4 — Edición de texto de alta fidelidad](https://github.com/xlCyanz/galera/milestone/5) | 12 | 7 |
| [Fase 5 — Productividad](https://github.com/xlCyanz/galera/milestone/6) | 9 | 0 |
| [Fase 6 — Plantillas y variables](https://github.com/xlCyanz/galera/milestone/7) | 7 | 0 |
| [Fase 7 — Texto que fluye](https://github.com/xlCyanz/galera/milestone/8) | 5 | 0 |
| [Fase 8 — Pulido y distribución](https://github.com/xlCyanz/galera/milestone/9) | 8 | 0 |
| **Total** | **95** | **59** |


---

## Fase 0 — Núcleo por terminal

**Objetivo:** JSON entra, PDF sale, sin interfaz.

**Criterios de salida de la fase:** `galera-cli fixtures/informe.json -o salida.pdf` genera un PDF correcto; las pruebas de instantánea del código generado pasan; un texto con `#*_$@` no rompe la compilación.

| Estado | Tarea | Issue | Depende de |
|:--:|---|:--:|---|
| ✅ | **F0-01** — Crear el workspace de Cargo con galera-core y galera-cli | [#1](https://github.com/xlCyanz/galera/issues/1) | ninguna |
| ✅ | **F0-02** — Definir el modelo de documento con serde | [#2](https://github.com/xlCyanz/galera/issues/2) | #1 |
| ✅ | **F0-03** — Validar el documento al cargarlo | [#3](https://github.com/xlCyanz/galera/issues/3) | #2 |
| ✅ | **F0-04** — Implementar el escape de texto hacia Typst | [#4](https://github.com/xlCyanz/galera/issues/4) | #1 |
| ✅ | **F0-05** — Emitir el esqueleto del documento y las páginas en Typst | [#5](https://github.com/xlCyanz/galera/issues/5) | #2, #4 |
| ✅ | **F0-06** — Generar rect, ellipse y line | [#6](https://github.com/xlCyanz/galera/issues/6) | #5 |
| ✅ | **F0-07** — Generar texto sin formato | [#7](https://github.com/xlCyanz/galera/issues/7) | #5 |
| ✅ | **F0-08** — Generar imagen desde los assets del proyecto | [#8](https://github.com/xlCyanz/galera/issues/8) | #5, #11 |
| ✅ | **F0-09** — Generar el bloque de código personalizado | [#9](https://github.com/xlCyanz/galera/issues/9) | #5 |
| ✅ | **F0-10** — Implementar typst::World con las fuentes del proyecto | [#10](https://github.com/xlCyanz/galera/issues/10) | #1 |
| ✅ | **F0-11** — Resolver assets y rutas del proyecto en World | [#11](https://github.com/xlCyanz/galera/issues/11) | #10 |
| ✅ | **F0-12** — Compilar a PDF | [#12](https://github.com/xlCyanz/galera/issues/12) | #5, #10 |
| ✅ | **F0-13** — Compilar a SVG | [#13](https://github.com/xlCyanz/galera/issues/13) | #12 |
| ✅ | **F0-14** — Construir la herramienta de terminal galera-cli | [#14](https://github.com/xlCyanz/galera/issues/14) | #12, #13 |
| ✅ | **F0-15** — Fixtures y pruebas de instantánea con insta | [#15](https://github.com/xlCyanz/galera/issues/15) | #6, #7, #8, #9 |
| ✅ | **F0-16** — Errores tipados y diagnósticos de Typst legibles | [#16](https://github.com/xlCyanz/galera/issues/16) | #3, #12 |

---

## Fase 1 — Ventana y vista fiel

**Objetivo:** Ver el documento renderizado por Typst dentro de la app.

**Criterios de salida de la fase:** Abrir un proyecto muestra el SVG idéntico al PDF exportado; zoom del 25 % al 800 % nítido; un error de compilación se muestra con su mensaje.

| Estado | Tarea | Issue | Depende de |
|:--:|---|:--:|---|
| ✅ | **F1-01** — Crear la app Tauri 2 con React, TypeScript y Vite | [#17](https://github.com/xlCyanz/galera/issues/17) | #14 |
| ✅ | **F1-02** — Enlazar galera-core con el backend Tauri | [#18](https://github.com/xlCyanz/galera/issues/18) | #17, #12 |
| ✅ | **F1-03** — Comando abrir_proyecto | [#19](https://github.com/xlCyanz/galera/issues/19) | #18, #11 |
| ✅ | **F1-04** — Comando compilar y obtener el SVG de una página | [#20](https://github.com/xlCyanz/galera/issues/20) | #19, #13 |
| ✅ | **F1-05** — Comando exportar a PDF | [#21](https://github.com/xlCyanz/galera/issues/21) | #19, #12 |
| ✅ | **F1-06** — Generar los tipos TypeScript del modelo | [#22](https://github.com/xlCyanz/galera/issues/22) | #2, #17 |
| ✅ | **F1-07** — Store de Zustand con documento y estado de compilación | [#23](https://github.com/xlCyanz/galera/issues/23) | #22 |
| ✅ | **F1-08** — Lienzo con la página centrada y el SVG de Typst | [#24](https://github.com/xlCyanz/galera/issues/24) | #20, #23 |
| ✅ | **F1-09** — Zoom del 25 % al 800 % y desplazamiento | [#25](https://github.com/xlCyanz/galera/issues/25) | #24 |
| ✅ | **F1-10** — Reglas en milímetros | [#26](https://github.com/xlCyanz/galera/issues/26) | #25 |
| ✅ | **F1-11** — Compilación en segundo plano con eventos | [#27](https://github.com/xlCyanz/galera/issues/27) | #20 |
| ✅ | **F1-12** — Barra de estado con tiempo de compilación y errores | [#28](https://github.com/xlCyanz/galera/issues/28) | #27 |
| ⬜ | **F1-13** — Estructura visual base según el brief de diseño | [#29](https://github.com/xlCyanz/galera/issues/29) | #24, #28 |

---

## Fase 2 — Layout y selección

**Objetivo:** Seleccionar y transformar elementos con medidas reales.

**Criterios de salida de la fase:** La caja de selección coincide exactamente con el contenido renderizado; mover 100 veces y deshacer 100 veces deja el documento igual que al inicio.

| Estado | Tarea | Issue | Depende de |
|:--:|---|:--:|---|
| ✅ | **F2-01** — Módulo layout: extraer la caja real de cada elemento | [#30](https://github.com/xlCyanz/galera/issues/30) | #12, #5 |
| ✅ | **F2-02** — Exponer el layout a la interfaz | [#31](https://github.com/xlCyanz/galera/issues/31) | #30, #20 |
| ✅ | **F2-03** — Hit-testing: del clic al elemento | [#32](https://github.com/xlCyanz/galera/issues/32) | #31 |
| ✅ | **F2-04** — Capa de controles: contorno y ocho manejadores | [#33](https://github.com/xlCyanz/galera/issues/33) | #32 |
| ✅ | **F2-05** — Mover elementos con arrastre optimista | [#34](https://github.com/xlCyanz/galera/issues/34) | #33, #37 |
| ✅ | **F2-06** — Redimensionar con los ocho manejadores | [#35](https://github.com/xlCyanz/galera/issues/35) | #34 |
| ✅ | **F2-07** — Rotar elementos | [#36](https://github.com/xlCyanz/galera/issues/36) | #35 |
| ✅ | **F2-08** — Módulo ops: comandos de edición | [#37](https://github.com/xlCyanz/galera/issues/37) | #2 |
| ✅ | **F2-09** — Historial de deshacer y rehacer | [#38](https://github.com/xlCyanz/galera/issues/38) | #37 |
| ✅ | **F2-10** — Inspector de posición, tamaño y rotación | [#39](https://github.com/xlCyanz/galera/issues/39) | #38, #31 |
| ✅ | **F2-11** — Prueba de robustez: 100 movimientos y 100 deshacer | [#40](https://github.com/xlCyanz/galera/issues/40) | #38, #34 |

---

## Fase 3 — Creación de elementos y paneles

**Objetivo:** Construir un documento entero sin tocar el JSON.

**Criterios de salida de la fase:** Se puede crear el documento de ejemplo del brief desde cero sin tocar el JSON.

| Estado | Tarea | Issue | Depende de |
|:--:|---|:--:|---|
| ✅ | **F3-01** — Riel de herramientas | [#41](https://github.com/xlCyanz/galera/issues/41) | #29, #33 |
| ✅ | **F3-02** — Crear rectángulo, elipse y línea | [#42](https://github.com/xlCyanz/galera/issues/42) | #41, #37 |
| ✅ | **F3-03** — Crear cuadro de texto | [#43](https://github.com/xlCyanz/galera/issues/43) | #42 |
| ✅ | **F3-04** — Insertar imagen, incluido arrastrar desde el sistema | [#44](https://github.com/xlCyanz/galera/issues/44) | #42, #47 |
| ✅ | **F3-05** — Panel de capas: listado y reordenar | [#45](https://github.com/xlCyanz/galera/issues/45) | #31 |
| ✅ | **F3-06** — Panel de capas: ocultar, bloquear y renombrar | [#46](https://github.com/xlCyanz/galera/issues/46) | #45, #2 |
| ✅ | **F3-07** — Panel de recursos: imágenes del proyecto | [#47](https://github.com/xlCyanz/galera/issues/47) | #19 |
| ✅ | **F3-08** — Panel de recursos: fuentes del proyecto | [#48](https://github.com/xlCyanz/galera/issues/48) | #47, #10 |
| ✅ | **F3-09** — Inspector de formas: relleno, borde y radio | [#49](https://github.com/xlCyanz/galera/issues/49) | #39, #6 |
| ✅ | **F3-10** — Inspector de texto: fuente, tamaño, color y alineación | [#50](https://github.com/xlCyanz/galera/issues/50) | #48, #7 |
| ✅ | **F3-11** — Formato .galera: guardar y abrir | [#51](https://github.com/xlCyanz/galera/issues/51) | #19, #44 |
| ✅ | **F3-12** — Guardado automático y recuperación | [#52](https://github.com/xlCyanz/galera/issues/52) | #51 |
| ✅ | **F3-13** — Atajos de teclado | [#53](https://github.com/xlCyanz/galera/issues/53) | #41, #38 |
| 🟡 | **F3-14** — Criterio de fase: reproducir el documento de ejemplo del brief ([análisis](criterio-fase-3.md)) | [#54](https://github.com/xlCyanz/galera/issues/54) | #41, #42, #43, #44, #49, #50, #51 |

---

## Fase 4 — Edición de texto de alta fidelidad

**Objetivo:** Escribir directamente sobre el render de Typst.

**Criterios de salida de la fase:** Escribir un párrafo de 500 caracteres se siente fluido (menos de 50 ms entre tecla y render en un documento de 5 páginas); el cursor nunca queda desalineado; los cortes de línea en pantalla son idénticos al PDF.

| Estado | Tarea | Issue | Depende de |
|:--:|---|:--:|---|
| 🟡 | **F4-01** — Spike: entrada de teclado e IME dentro del webview ([decisión](decisiones/ime.md)) | [#55](https://github.com/xlCyanz/galera/issues/55) | #17 |
| ✅ | **F4-02** — Campo invisible que captura teclado, IME y pegado | [#56](https://github.com/xlCyanz/galera/issues/56) | #55 |
| ✅ | **F4-03** — Modelo de texto enriquecido por runs y sus operaciones | [#57](https://github.com/xlCyanz/galera/issues/57) | #2, #37 |
| ✅ | **F4-04** — Compilación incremental y caché por página ([medidas](decisiones/compilacion-incremental.md)) | [#58](https://github.com/xlCyanz/galera/issues/58) | #27, #12 |
| ✅ | **F4-05** — Extraer posiciones de glifos del layout de Typst | [#59](https://github.com/xlCyanz/galera/issues/59) | #30 |
| ✅ | **F4-06** — Dibujar el cursor a partir de las posiciones de glifos | [#60](https://github.com/xlCyanz/galera/issues/60) | #59, #56 |
| ✅ | **F4-07** — Selección de texto con clic y arrastre | [#61](https://github.com/xlCyanz/galera/issues/61) | #60 |
| ✅ | **F4-08** — Formato: negrita, cursiva, subrayado y color | [#62](https://github.com/xlCyanz/galera/issues/62) | #57, #61 |
| 🟡 | **F4-09** — Enlaces y listas (los enlaces, hechos; las listas, [#174](https://github.com/xlCyanz/galera/issues/174)) | [#63](https://github.com/xlCyanz/galera/issues/63) | #62 |
| ⬜ | **F4-10** — Aviso de desbordamiento en cajas de altura fija | [#64](https://github.com/xlCyanz/galera/issues/64) | #59, #7 |
| ⬜ | **F4-11** — Banco de rendimiento: menos de 50 ms por tecla | [#65](https://github.com/xlCyanz/galera/issues/65) | #58, #60 |
| ⬜ | **F4-12** — Prueba de fidelidad: cortes de línea idénticos al PDF | [#66](https://github.com/xlCyanz/galera/issues/66) | #59, #12 |

---

## Fase 5 — Productividad

**Objetivo:** Guías, multiselección, páginas y código.

**Criterios de salida de la fase:** Guías inteligentes, multiselección, gestión de páginas, copiar/pegar entre documentos y panel de código funcionando.

| Estado | Tarea | Issue | Depende de |
|:--:|---|:--:|---|
| ⬜ | **F5-01** — Módulo snap: cálculo de guías y ajuste | [#67](https://github.com/xlCyanz/galera/issues/67) | #30 |
| ⬜ | **F5-02** — Guías inteligentes en el lienzo | [#68](https://github.com/xlCyanz/galera/issues/68) | #67, #34 |
| ⬜ | **F5-03** — Multiselección | [#69](https://github.com/xlCyanz/galera/issues/69) | #32, #33 |
| ⬜ | **F5-04** — Agrupar y desagrupar | [#70](https://github.com/xlCyanz/galera/issues/70) | #69, #2 |
| ⬜ | **F5-05** — Alinear y distribuir | [#71](https://github.com/xlCyanz/galera/issues/71) | #69 |
| ⬜ | **F5-06** — Gestión de páginas | [#72](https://github.com/xlCyanz/galera/issues/72) | #51 |
| ⬜ | **F5-07** — Copiar y pegar, incluido entre documentos | [#73](https://github.com/xlCyanz/galera/issues/73) | #69, #51 |
| ⬜ | **F5-08** — Panel de código Typst en solo lectura | [#74](https://github.com/xlCyanz/galera/issues/74) | #20, #31 |
| ⬜ | **F5-09** — Bloque de código personalizado con CodeMirror 6 | [#75](https://github.com/xlCyanz/galera/issues/75) | #74, #9 |

---

## Fase 6 — Plantillas y variables

**Objetivo:** Plantillas, variables y generación en lote.

**Criterios de salida de la fase:** Las seis plantillas del brief se abren y se rellenan desde un CSV generando PDFs correctos.

| Estado | Tarea | Issue | Depende de |
|:--:|---|:--:|---|
| ⬜ | **F6-01** — Variables del documento y panel de variables | [#76](https://github.com/xlCyanz/galera/issues/76) | #2, #50 |
| ⬜ | **F6-02** — Fichas {{variable}} dentro del texto | [#77](https://github.com/xlCyanz/galera/issues/77) | #76, #57 |
| ⬜ | **F6-03** — Infraestructura de plantillas | [#78](https://github.com/xlCyanz/galera/issues/78) | #51 |
| ⬜ | **F6-04** — Las seis plantillas del brief | [#79](https://github.com/xlCyanz/galera/issues/79) | #78, #77 |
| ⬜ | **F6-05** — Importar CSV para generación en lote | [#80](https://github.com/xlCyanz/galera/issues/80) | #76 |
| ⬜ | **F6-06** — Generación en lote a varios PDF o a uno combinado | [#81](https://github.com/xlCyanz/galera/issues/81) | #80, #12 |
| ⬜ | **F6-07** — Exportar a SVG, PNG y .typ | [#82](https://github.com/xlCyanz/galera/issues/82) | #21, #13 |

---

## Fase 7 — Texto que fluye

**Objetivo:** El diferenciador: texto enlazado entre páginas y tablas.

**Criterios de salida de la fase:** Un texto largo fluye entre zonas enlazadas de varias páginas y las tablas se editan desde la interfaz.

| Estado | Tarea | Issue | Depende de |
|:--:|---|:--:|---|
| ⬜ | **F7-01** — Modelo del elemento flow y enlace entre zonas | [#83](https://github.com/xlCyanz/galera/issues/83) | #2, #72 |
| ⬜ | **F7-02** — Codegen del texto que fluye entre páginas | [#84](https://github.com/xlCyanz/galera/issues/84) | #83, #7 |
| ⬜ | **F7-03** — Edición de texto dentro de un flow | [#85](https://github.com/xlCyanz/galera/issues/85) | #84, #61 |
| ⬜ | **F7-04** — Modelo y codegen de tablas | [#86](https://github.com/xlCyanz/galera/issues/86) | #2, #5 |
| ⬜ | **F7-05** — Edición de tablas en la interfaz | [#87](https://github.com/xlCyanz/galera/issues/87) | #86, #61 |

---

## Fase 8 — Pulido y distribución

**Objetivo:** Modo oscuro, accesibilidad, rendimiento y empaquetado.

**Criterios de salida de la fase:** App firmada y distribuible, accesible por teclado y fluida con documentos de 50 páginas.

| Estado | Tarea | Issue | Depende de |
|:--:|---|:--:|---|
| ⬜ | **F8-01** — Modo oscuro de la interfaz | [#88](https://github.com/xlCyanz/galera/issues/88) | #29 |
| ⬜ | **F8-02** — Navegación por teclado y gestión del foco | [#89](https://github.com/xlCyanz/galera/issues/89) | #53 |
| ⬜ | **F8-03** — Accesibilidad: roles, nombres y contraste | [#90](https://github.com/xlCyanz/galera/issues/90) | #89, #88 |
| ⬜ | **F8-04** — Rendimiento con documentos de 50 páginas | [#91](https://github.com/xlCyanz/galera/issues/91) | #65, #58 |
| ⬜ | **F8-05** — Firma y notarización para macOS | [#92](https://github.com/xlCyanz/galera/issues/92) | #51 |
| ⬜ | **F8-06** — Empaquetado para Windows | [#93](https://github.com/xlCyanz/galera/issues/93) | #92 |
| ⬜ | **F8-07** — Publicación de releases automatizada | [#94](https://github.com/xlCyanz/galera/issues/94) | #92, #93 |
| ⬜ | **F8-08** — Manual de usuario y notas de la primera versión | [#95](https://github.com/xlCyanz/galera/issues/95) | #94, #79 |

---

## Resúmenes de fin de fase

Al terminar cada fase se anota aquí qué se hizo, qué quedó pendiente y qué decisiones técnicas nuevas se tomaron.

### Fase 0 — Núcleo por terminal ✅

**Criterio de salida cumplido.** `galera-cli fixtures/informe.json -o salida.pdf` genera el PDF con Inter incrustada; las instantáneas del código generado pasan; un texto con `#*_$@` compila y sale literal (comprobado renderizando `fixtures/escape.json`). Cada punto tiene su prueba automática.

**Qué se hizo**

| Módulo | Qué hace |
|---|---|
| `model` | Documento con serde, forma canónica, versión validada al leer. |
| `model::validate` | Todos los problemas de una vez, cada uno con su elemento: ids, recursos, familias, medidas, colores. |
| `codegen` | JSON → Typst: escape, página, formas, texto, imagen y bloque de código. |
| `project` | La única frontera de acceso a archivos: nada fuera de la carpeta, ni por `..`, ni por ruta absoluta, ni por enlace simbólico. |
| `world` | `typst::World` con las fuentes del proyecto y nunca las del sistema. |
| `compile` | Una compilación, dos exportaciones (PDF y SVG) que coinciden al 0,01 pt. |
| `error` | `GaleraError` único, serializable, con el elemento de cada diagnóstico. |
| `galera-cli` | PDF, SVG por página y `--emit-typst`. |
| `fixtures/` | Nueve documentos con instantánea, que además compilan. |

**Decisiones técnicas nuevas**

- **Typst 0.15.1**, fijado con `=`; exige Rust 1.92, que pasa a ser el mínimo. La API de `World` se leyó del código fuente, no de ejemplos: difiere en `today`, en las rutas virtuales y en dónde vive `PagedDocument`.
- **La línea se define por dos extremos** (`x`, `y`, `x2`, `y2`), no por ancho y alto.
- **Serialización canónica**: mismo documento, mismos bytes.
- **El escape cubre más que la lista de la guía**: `/` (comentarios y autoenlaces), `~`, y los marcadores de bloque al principio de línea. Las comillas y rayas tipográficas se dejan pasar.
- **Los bloques de código se evalúan con `eval`**, que da un error limpio en vez de varios y posiciones relativas al bloque. No aísla del disco ni salva el resto del documento: eso se afirmó por error en #109 y se corrigió en #111.
- **Una familia tipográfica que no está es un error**, no el aviso de Typst que cambiaría la fuente en silencio.
- **Ids de página y de elemento con la misma regla** (ASCII, guion, guion bajo) y un solo espacio de nombres. La de página se añadió tras encontrar una inyección por comentario.
- **Ningún `unwrap` ni `expect` fuera de las pruebas**, impuesto por clippy.

**Qué queda pendiente o diferido**

- El `World` se reutiliza entre compilaciones desde F4-04 (#58); el dibujo de cada página también, si la página no ha cambiado. Recomponer sigue costando el documento entero: ver [decisiones/compilacion-incremental.md](decisiones/compilacion-incremental.md).
- `today()` usa UTC cuando Typst pide la fecha local.
- Las imágenes con ancho y alto usan el ajuste por defecto de Typst (`cover`); no hay campo para elegir otro.
- Que la etiqueta detrás de `place` permite localizar la caja del contenido quedó comprobado en F2-01 (#30): Typst deja marcas de inicio y fin del `place` etiquetado en la página. Para ello, un rectángulo o una elipse sin relleno ni borde se emiten dentro de `#block(…)`, que no dibuja nada pero deja su caja.
- Inter no tiene emoji ni escrituras CJK, y Galera no recurre a fuentes del sistema: esos caracteres salen vacíos si el documento no trae una fuente que los tenga. A tener en cuenta en el panel de fuentes (F3-08, #48).
- `docs/galera-design-brief.md` sigue sin estar en el repositorio; bloquea F1-13 (#29).

