# Galera 0.1

La primera versión. Lo que trae, para qué sirve ya y qué le falta.

## Qué es

Un editor de documentos en el que colocas las cosas con el ratón y lo que ves
lo compone **Typst**, el mismo motor que escribe el PDF. No hay una vista
previa que se parezca al resultado: el lienzo **es** el resultado. Los saltos
de línea, los tamaños y las posiciones no se mueven al exportar.

Sirve para documentos de una o pocas páginas con buen acabado —informes,
cartas, facturas, certificados, credenciales— y para generarlos **en lote**
desde una hoja de cálculo.

## Lo que trae

**Diseñar la página**

- Textos, rectángulos, elipses, líneas, imágenes y bloques de código Typst,
  con posición, tamaño y giro en milímetros.
- Guías que enganchan a los bordes, los centros y los espaciados de los
  demás elementos y de la página. Alinear y repartir. Reglas en milímetros.
- Capas: reordenar, ocultar, bloquear y poner nombre. Grupos.
- Varias páginas por documento, cada una con su tamaño: A4, A5, A3, Carta,
  Legal… en vertical o en horizontal, o a medida.
- Borrar con `⌫` o `Supr`, y deshacer y rehacer todo, con el nombre de lo
  que se deshace.
- Copiar y pegar entre documentos, con las fuentes y las imágenes que hagan
  falta.

**Escribir**

- Edición de texto directamente sobre la página, con el cursor en la
  posición que da Typst.
- Negrita, cursiva, subrayado, color, enlaces y listas con viñetas o
  numeradas.
- Tablas, con su herramienta: filas y columnas que se añaden y se quitan,
  celdas que se combinan y se separan, y columnas automáticas, fijas o
  proporcionales.
- Textos que fluyen de una zona a otra y de página en página: se dibujan
  las zonas una detrás de otra y el texto las recorre.

**Plantillas y lotes**

- Seis plantillas: informe, carta con membrete, factura, certificado,
  credencial de evento y boletín a dos columnas.
- Variables de texto, número, fecha e imagen, que se insertan en el texto
  como fichas.
- Generación en lote desde un CSV: un PDF por fila o todos en uno, con
  comprobación de cada fila antes de generar.

**Archivos**

- Proyectos autocontenidos, como carpeta o como un solo archivo `.galera`:
  llevan dentro sus fuentes y sus imágenes, y se ven igual en cualquier
  ordenador.
- Exportar a PDF, a SVG o PNG por página, o al código Typst.
- Copia automática de lo que no se ha guardado, y recuperación si la app se
  cierra de golpe.

**Uso**

- Todo se puede hacer con el teclado, con el foco siempre a la vista.
  Atajos para lo habitual (`⌘/` los enseña).
- Tema claro y oscuro, o el del sistema.
- Nombres accesibles y contraste suficiente para lectores de pantalla.
- Fluido con documentos largos: en uno de 50 páginas, cada tecla tarda unos
  16 ms en el núcleo.

**Plataformas**

- **macOS**, Apple Silicon e Intel en un solo `.dmg`, todavía sin firmar:
  la primera vez hay que permitirla en Ajustes del Sistema → Privacidad y
  seguridad («Abrir igualmente»).
- **Windows** 10 y 11, con un instalador `.exe`, todavía sin firmar.

## Lo que todavía no hace

Son las cosas que más se echan de menos. Están apuntadas para las próximas
versiones.

- **Más estilos de fuente** que negrita, cursiva y subrayado: el peso y el
  estilo se eligen con la familia.
- **Ajustar cómo se encaja una imagen** en su caja: con el ancho y el alto
  fijos, se recorta para llenarla. Con el alto automático, conserva su
  proporción.
- **Linux**: se puede compilar, pero no se publica un paquete.
- **La disposición de la ventana** es provisional y cambiará con el diseño
  definitivo de la interfaz.

## Cambios

La lista completa de cambios, commit a commit, está en el
[CHANGELOG](../../CHANGELOG.md).
