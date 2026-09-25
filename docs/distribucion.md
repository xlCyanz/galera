# Distribución

Cómo se empaqueta Galera para repartirla: macOS y Windows. Lo hace el
workflow [`release.yml`](../.github/workflows/release.yml) (*Empaquetado*);
publicar lo empaquetado en una release llega con F8-07
([#94](https://github.com/xlCyanz/galera/issues/94)).

## macOS

F8-05 ([#92](https://github.com/xlCyanz/galera/issues/92)).

Lo que se reparte es un **`.dmg` universal** —un solo binario para Apple
Silicon y para Intel—, **firmado** con un certificado Developer ID y
**notarizado** por Apple. Así Gatekeeper lo abre sin preguntar: ni el `.dmg`
ni la app que lleva dentro.

Lo hace el workflow [`release.yml`](../.github/workflows/release.yml):

| Cuándo | Qué hace |
|---|---|
| Al subir una etiqueta `v*` | Compila, firma, notariza y deja el `.dmg` como artefacto del workflow |
| A mano (*Run workflow* en Actions) | Lo mismo, para probar sin etiquetar |
| En un PR que toca el empaquetado | Lo mismo **sin firmar**: los PR no ven los secrets. Comprueba que el `.dmg` sale y que el binario es universal |

Sin los secrets de firma, una etiqueta o una ejecución a mano **fallan**: lo
que se reparte tiene que ir firmado.

### Los pasos

1. **Compilar** con `pnpm tauri build --target universal-apple-darwin`:
   compila para las dos arquitecturas y las une en un binario.
2. **Firmar la app** con el runtime endurecido, **notarizarla** y **grapar**
   el resultado: lo hace Tauri solo, con `APPLE_SIGNING_IDENTITY` y la clave
   de la API de App Store Connect.
3. **Firmar, notarizar y grapar el `.dmg`**: Tauri notariza la app, no la
   imagen que la contiene, así que eso va aparte, con `codesign`,
   `xcrun notarytool` y `xcrun stapler`.
4. **Comprobar lo que mira Gatekeeper** en un Mac que nunca ha visto la app:
   `codesign --verify`, `stapler validate` y `spctl --assess`, para la app y
   para el `.dmg`. Si algo no está, el workflow falla.

Grapar (*staple*) mete el justificante de la notarización dentro del
archivo: Gatekeeper no tiene que preguntar a Apple, y la app se abre también
sin conexión.

### Los secrets

Viven en **Settings → Secrets and variables → Actions** del repositorio,
nunca en el código. Son cinco:

| Secret | Qué es |
|---|---|
| `APPLE_CERTIFICATE` | El certificado *Developer ID Application* con su clave privada, exportado en `.p12` y pasado a base64 |
| `APPLE_CERTIFICATE_PASSWORD` | La contraseña con que se exportó el `.p12` |
| `APPLE_API_KEY_ID` | El identificador de la clave de la API de App Store Connect |
| `APPLE_API_ISSUER` | El *Issuer ID* de esa clave |
| `APPLE_API_KEY_P8` | El contenido del archivo `.p8` de la clave |

Para notarizar se usa una **clave de la API de App Store Connect** y no el
Apple ID con una contraseña de aplicación: no depende de la cuenta de una
persona ni de su verificación en dos pasos, y se puede revocar sin tocar
nada más.

### Conseguirlos

Hace falta estar en el **Apple Developer Program** (de pago), como titular
o administrador de la cuenta.

**El certificado**, desde un Mac:

1. Acceso a Llaveros → Asistente de certificados → *Solicitar un
   certificado de una autoridad de certificación*. Guardar la solicitud en
   el disco.
2. En [developer.apple.com](https://developer.apple.com/account/resources/certificates/list),
   crear un certificado **Developer ID Application** con esa solicitud,
   descargarlo y abrirlo: queda en el llavero junto con su clave privada.
3. En Acceso a Llaveros, exportar el certificado —con su clave— como `.p12`,
   con una contraseña.
4. Subirlo:

   ```bash
   base64 -i certificado.p12 | gh secret set APPLE_CERTIFICATE
   gh secret set APPLE_CERTIFICATE_PASSWORD
   ```

   Y borrar el `.p12` del disco.

**La clave para notarizar:**

1. En [App Store Connect → Usuarios y acceso → Integraciones → Claves de la
   API de App Store Connect](https://appstoreconnect.apple.com/access/integrations/api),
   crear una clave de equipo con el rol **Developer**.
2. Descargar el `.p8` —solo se puede una vez— y apuntar su *Key ID* y el
   *Issuer ID* de la página.
3. Subirlo:

   ```bash
   gh secret set APPLE_API_KEY_ID
   gh secret set APPLE_API_ISSUER
   gh secret set APPLE_API_KEY_P8 < AuthKey_XXXXXXXXXX.p8
   ```

   Y guardar el `.p8` en un sitio seguro, fuera del repositorio.

### Probarlo

- **Sin etiquetar:** Actions → *Empaquetado* → *Run workflow*. El `.dmg` queda en
  los artefactos de la ejecución.
- **En un Mac limpio** —uno que no haya compilado Galera ni la haya abierto
  nunca—, descargar el `.dmg` con el navegador, abrirlo y arrastrar la app a
  Aplicaciones. Tiene que abrirse sin ningún aviso de seguridad. Si pregunta
  «¿Seguro que quieres abrirla?», algo falló: el workflow debería haberlo
  parado antes.
- **En local**, sin firmar: `pnpm tauri build`. Para el universal hacen
  falta las dos arquitecturas (`rustup target add x86_64-apple-darwin`) y
  unos cuantos gigas de disco.

### Qué no hace falta

- **Entitlements.** Galera no usa el App Sandbox —abre y guarda donde elija
  quien la usa— ni necesita excepciones del runtime endurecido: el webview
  corre en su propio proceso.
- **Firmar en local.** Solo firma el workflow: el certificado no sale de los
  secrets.

## Windows

F8-06 ([#93](https://github.com/xlCyanz/galera/issues/93)).

Lo que se reparte es un **instalador `.exe`** hecho con NSIS. Instala Galera
para quien lo abre, sin pedir permisos de administrador, y si al equipo le
falta WebView2 —el motor del webview, que Windows 10 y 11 suelen traer ya—
lo descarga durante la instalación.

Lo hace el mismo workflow, en el job *instalador de Windows*, cada vez que
corre el de macOS: al etiquetar, a mano y en los PR que tocan el
empaquetado. El instalador queda como artefacto.

**Va sin firmar.** Windows lo instala, pero SmartScreen avisa de que no
conoce al editor hasta que el instalador acumula descargas. Firmarlo pide un
certificado de firma de código, que es otra cuenta y otro gasto; cuando lo
haya, se firma en este mismo job y sus secrets van con los de Apple.

### Que el núcleo haga lo mismo en Windows

El CI compila y pasa todas las pruebas también en Windows (`windows-latest`
en la matriz de Rust de [`ci.yml`](../.github/workflows/ci.yml)), y además:

- **El mismo PDF en todos los sistemas.** Cada sistema saca el PDF de cada
  fixture de `fixtures/` con `galera-cli`, y el job *El mismo PDF en todos
  los sistemas* los compara **byte a byte**. Si Windows cargara otra fuente,
  compusiera otro corte de línea o escribiera otra fecha, saldría distinto y
  el CI fallaría. Se puede porque las fuentes son las del proyecto, nunca las
  del sistema, y el PDF no lleva fecha.
- **Las rutas.** La carpeta del proyecto se escribe como en cada sistema
  (`C:\Users\…`), pero las rutas **dentro del documento** van siempre con
  `/`, que Windows entiende igual. Una ruta con `\` se rechaza en todos los
  sistemas con un error que lo dice: en Windows funcionaría y en macOS no, y
  el documento tiene que abrirse igual en todas partes (ver
  `crates/galera-core/src/project.rs`). Una unidad (`C:/…`) o una ruta de red
  (`//servidor/…`) son rutas absolutas, y se rechazan como cualquier otra.
- **Los saltos de línea.** `.gitattributes` obliga a LF también en Windows:
  las instantáneas y los fixtures se comparan byte a byte, y un CRLF los haría
  distintos sin que nada cambiara.

### Probarlo

- **Sin etiquetar:** Actions → *Empaquetado* → *Run workflow*, y descargar
  el artefacto `galera-windows`.
- **En local**, en un Windows con Rust, Node y pnpm: `pnpm tauri build
  --bundles nsis`. El instalador sale en `target/release/bundle/nsis/`.

