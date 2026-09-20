# Atajos de teclado

Todos los atajos de Galera. Es la misma lista que responde al teclado: sale
de `app/src/shortcuts.ts`, y una prueba (`app/src/shortcuts.test.ts`)
comprueba que este archivo no se separa de ella.

En macOS el modificador es ⌘; en Windows y Linux, Ctrl.

## La lista

### Archivo

| Qué hace | macOS | Windows y Linux |
|---|---|---|
| Abrir una carpeta de proyecto | `⌘O` | `Ctrl+O` |
| Abrir un archivo .galera | `⌘⇧O` | `Ctrl+Shift+O` |
| Guardar | `⌘S` | `Ctrl+S` |
| Guardar como .galera… | `⌘⇧S` | `Ctrl+Shift+S` |
| Exportar a PDF… | `⌘⇧E` | `Ctrl+Shift+E` |

### Edición

| Qué hace | macOS | Windows y Linux |
|---|---|---|
| Deshacer | `⌘Z` | `Ctrl+Z` |
| Rehacer | `⌘⇧Z` | `Ctrl+Shift+Z` |
| Quitar la selección | `Esc` | `Esc` |
| Mover 1 mm a la izquierda (10 mm con ⇧) | `←` | `←` |
| Mover 1 mm a la derecha | `→` | `→` |
| Mover 1 mm hacia arriba | `↑` | `↑` |
| Mover 1 mm hacia abajo | `↓` | `↓` |

### Herramientas

| Qué hace | macOS | Windows y Linux |
|---|---|---|
| Selección | `V` | `V` |
| Texto | `T` | `T` |
| Rectángulo | `R` | `R` |
| Elipse | `O` | `O` |
| Línea | `L` | `L` |
| Imagen | `I` | `I` |
| Mano | `H` | `H` |

### Vista

| Qué hace | macOS | Windows y Linux |
|---|---|---|
| Acercar | `⌘+` | `Ctrl++` |
| Alejar | `⌘−` | `Ctrl+−` |
| Zoom al 100 % | `⌘0` | `Ctrl+0` |
| Ajustar la página a la ventana | `⌘1` | `Ctrl+1` |
| Enseñar u ocultar las reglas | `⇧R` | `Shift+R` |

### Ayuda

| Qué hace | macOS | Windows y Linux |
|---|---|---|
| Ver todos los atajos | `⌘/` | `Ctrl+/` |

## Cómo funcionan

- **Un solo sitio.** Cada atajo está en `app/src/shortcuts.ts` con su nombre,
  su grupo y sus teclas. Quien lo atiende lo registra por su id
  (`useShortcut("save", …)`), y hay **un único** listener de teclado en toda
  la app (`app/src/hooks/useShortcuts.ts`).
- **Mientras se escribe.** En un campo de texto una letra suelta es texto:
  ahí solo valen los atajos con ⌘ o Ctrl, y ni siquiera deshacer y rehacer,
  que son los del propio campo.
- **Dentro de un gesto.** Mientras se arrastra, se redimensiona, se gira o se
  dibuja, `Esc` cancela **ese gesto** y `⇧` lo restringe (proporción, ángulos
  de 45°, movimiento recto). No son atajos: son parte del gesto, y solo
  valen mientras dura.
- **La barra espaciadora**, mantenida, deja desplazar la página arrastrando.
  Tampoco es un atajo: cuenta mientras está pulsada.

## La hoja de atajos en la app

El botón **Atajos** de la barra, o `⌘/`, abre la lista completa dentro de la
app, con las teclas de este sistema. Se cierra con `Esc`, con el botón o
pulsando fuera.

## Pendiente

El brief de diseño (F1-13, [#29](https://github.com/xlCyanz/galera/issues/29))
todavía no está en el repositorio. Estos atajos siguen la convención de los
editores de diseño; cuando llegue el brief, se ajustan en
`app/src/shortcuts.ts` y esta lista se actualiza con ellos.
