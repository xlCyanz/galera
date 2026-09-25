# Capturas del manual

Las capturas que usa el manual. Se hacen a mano, con la app abierta: la
interfaz la dibuja el webview y Typst, y no hay forma de sacarlas en una
prueba.

**Estado: pendientes.** Mientras no estén, el manual lleva en su lugar una
nota «📷 Captura pendiente» con el nombre del archivo. Al añadir una, se
cambia esa nota por la imagen:

```markdown
![La ventana con el informe abierto](capturas/02-ventana-con-documento.png)
```

## La lista

| Archivo | Qué enseña | Dónde se usa |
|---|---|---|
| `01-ventana-vacia.png` | La ventana al abrirla por primera vez, con la galería de plantillas | [Primeros pasos](../primeros-pasos.md#1-instalar) |
| `02-ventana-con-documento.png` | La ventana con «Informe sencillo» abierto, un texto seleccionado y el inspector | [Primeros pasos](../primeros-pasos.md#3-la-ventana) |
| `03-editando-texto.png` | Un texto en edición, con un trozo seleccionado y la barra de formato | [Primeros pasos](../primeros-pasos.md#4-cambiar-el-texto) |
| `04-exportar.png` | El diálogo «Exportar» con PNG elegido | [Primeros pasos](../primeros-pasos.md#8-exportar-el-pdf) |
| `05-plantillas.png` | La galería «Empezar con una plantilla» | [Plantillas, variables y lotes](../plantillas-y-lotes.md#las-plantillas) |
| `06-lote.png` | El panel «Lote» con un CSV cargado, las columnas relacionadas y la vista previa | [Plantillas, variables y lotes](../plantillas-y-lotes.md#generar-en-lote) |

## Cómo hacerlas

- En macOS, tema **claro**, ventana de 1280 × 800 (el tamaño con que abre),
  `⌘⇧4` y espacio para capturar solo la ventana.
- Con los fixtures y las plantillas del repositorio, sin datos personales.
- PNG, sin comprimir con pérdida. Si pesan más de 500 KB, reducirlas a 1600
  px de ancho.
