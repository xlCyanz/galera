//! Comandos de edición: la única forma de cambiar un documento.
//!
//! Nada modifica el documento por su cuenta. Cada cambio es un [`Op`]
//! explícito y serializable, que se aplica a un documento y devuelve el
//! documento nuevo **y el comando que lo deshace** ([`Applied`]). Eso es lo
//! que hace posible el historial de deshacer y rehacer ([`history`]) y, más
//! adelante, la colaboración.
//!
//! # Deshacer sin perder precisión
//!
//! El comando que deshace no recalcula nada: guarda lo que había. Deshacer
//! un movimiento no resta lo que se sumó —con coma flotante, cien idas y
//! vueltas no volverían exactamente al principio—, sino que restaura una
//! copia exacta del elemento ([`Op::Restore`]). Crear se deshace eliminando;
//! eliminar, volviendo a crear en el mismo sitio; reordenar, volviendo a la
//! posición anterior.
//!
//! # Lo que no hace
//!
//! No valida el resultado: un ancho negativo es un documento que no pasa la
//! validación, y eso lo dice [`Document::validate`] al compilar, como con
//! cualquier otro documento. Aquí solo se rechaza lo que no se puede
//! aplicar: un id que no existe, una propiedad que el elemento no tiene.

pub mod align;
pub mod flow;
pub mod group;
pub mod history;
pub mod pages;
mod text;

use serde::{Deserialize, Serialize};

use crate::layout::MmRect;
use crate::model::text::{Format, TextError};
use crate::model::{
    Document, Element, Flow, Line, Page, Run, Stroke, TextStyle, Variable, is_valid_id,
};
use crate::variables;

/// Un cambio del documento.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "ops.ts"))]
pub enum Op {
    /// Desplaza un elemento `dx`, `dy` milímetros. Una línea mueve sus dos
    /// extremos.
    Move {
        /// El elemento.
        id: String,
        /// Hacia la derecha, en mm.
        dx: f64,
        /// Hacia abajo, en mm.
        dy: f64,
    },

    /// Cambia la caja de un elemento: posición y tamaño. `h: null` deja el
    /// alto a Typst. Una línea no tiene caja: se cambian sus extremos.
    Resize {
        /// El elemento.
        id: String,
        /// Nueva esquina superior izquierda, en mm.
        x: f64,
        /// Nueva esquina superior izquierda, en mm.
        y: f64,
        /// Nuevo ancho, en mm.
        w: f64,
        /// Nuevo alto, en mm, o `null` para el automático.
        h: Option<f64>,
    },

    /// Cambia el giro de un elemento, en grados en sentido horario.
    Rotate {
        /// El elemento.
        id: String,
        /// El giro nuevo.
        rotation: f64,
    },

    /// Mete texto en un bloque de texto.
    ///
    /// `at` se cuenta en caracteres, no en bytes: ver
    /// [`crate::model::text`]. Lo que se escribe sigue el formato del tramo
    /// que tiene a la izquierda.
    InsertText {
        /// El elemento.
        id: String,
        /// Dónde se mete, en caracteres desde el principio del texto.
        at: usize,
        /// Lo que se escribe.
        text: String,
    },

    /// Borra un trozo de un bloque de texto: el tramo `[from, to)`.
    DeleteText {
        /// El elemento.
        id: String,
        /// Dónde empieza, en caracteres.
        from: usize,
        /// Dónde acaba, sin incluirlo.
        to: usize,
    },

    /// Cambia cómo se componen las líneas de un bloque de texto que toca
    /// el tramo `[from, to)`: si son elementos de una lista y con cuánto
    /// anidado.
    SetLines {
        /// El elemento.
        id: String,
        /// Dónde empieza, en caracteres.
        from: usize,
        /// Dónde acaba, sin incluirlo.
        to: usize,
        /// Cómo quedan esas líneas.
        line: Line,
    },

    /// Cambia el formato de un trozo de un bloque de texto.
    FormatText {
        /// El elemento.
        id: String,
        /// Dónde empieza, en caracteres.
        from: usize,
        /// Dónde acaba, sin incluirlo.
        to: usize,
        /// Qué se cambia. Lo que no se diga se queda como estaba.
        format: Format,
    },

    /// Cambia una propiedad de un elemento.
    SetProperty {
        /// El elemento.
        id: String,
        /// La propiedad y su valor nuevo.
        property: Property,
    },

    /// Crea un elemento en una página. Sin `index`, queda encima de todos.
    Create {
        /// La página, por su id.
        page: String,
        /// Dónde en el orden de capas: 0 es el de más abajo.
        index: Option<usize>,
        /// El elemento, con un id que no use nadie.
        element: Element,
    },

    /// Elimina un elemento.
    Delete {
        /// El elemento.
        id: String,
    },

    /// Cambia el id de un elemento.
    ///
    /// El id se ve en el JSON, en los errores de compilación y en la
    /// etiqueta `<el-ID>` del código Typst, así que se puede elegir.
    Rename {
        /// El elemento.
        id: String,
        /// Su id nuevo.
        to: String,
    },

    /// Mueve un elemento a otra posición del orden de capas de su página.
    /// Un `index` más allá del final lo deja encima de todos.
    Reorder {
        /// El elemento.
        id: String,
        /// La posición nueva: 0 es la de más abajo.
        index: usize,
    },

    /// Sustituye un elemento por una copia, con el mismo id. Es lo que
    /// deshace mover, redimensionar, girar y cambiar propiedades.
    Restore {
        /// El elemento tal como tiene que quedar.
        element: Element,
    },

    /// Registra un archivo del proyecto en el mapa `assets` con una clave.
    /// Es lo que deshace [`Op::RemoveAsset`].
    AddAsset {
        /// La clave nueva.
        key: String,
        /// La ruta del archivo, relativa a la raíz del proyecto.
        path: String,
    },

    /// Quita una clave del mapa `assets`. Solo si ningún elemento la usa; el
    /// archivo se queda en la carpeta del proyecto.
    RemoveAsset {
        /// La clave.
        key: String,
    },

    /// Pone el valor de una variable del documento, creándola si no estaba.
    SetVariable {
        /// Su nombre.
        name: String,
        /// Lo que pasa a ser: su tipo y su valor.
        variable: Variable,
    },

    /// Quita una variable del documento.
    RemoveVariable {
        /// Su nombre.
        name: String,
    },

    /// Cambia el nombre de una variable, conservando su valor.
    RenameVariable {
        /// El nombre de ahora.
        from: String,
        /// El nombre nuevo.
        to: String,
    },

    /// Cambia el título del documento (`meta.title`).
    SetTitle {
        /// El título nuevo, sin espacios sobrantes a los lados.
        title: String,
    },

    /// Declara una fuente del proyecto en `fonts`. Es lo que deshace
    /// [`Op::RemoveFont`].
    AddFont {
        /// La ruta del archivo, relativa a la raíz del proyecto.
        path: String,
        /// Dónde en la lista; sin él, al final.
        index: Option<usize>,
    },

    /// Deja de declarar una fuente. El archivo se queda en la carpeta del
    /// proyecto. Que ningún texto la necesite lo comprueba quien lo pide,
    /// porque saber qué familias trae un archivo exige leerlo.
    RemoveFont {
        /// La ruta tal como está en `fonts`.
        path: String,
    },

    /// Cambia la clave de un recurso, y con ella la de todas las imágenes
    /// que la usan.
    RenameAsset {
        /// La clave de ahora.
        from: String,
        /// La clave nueva.
        to: String,
    },

    /// Mete una página en el documento, en `index` o al final.
    ///
    /// Es también lo que deshace [`Op::RemovePage`]: la misma página, con
    /// sus elementos tal como estaban.
    InsertPage {
        /// Dónde va, contando desde 0; sin él, al final.
        index: Option<usize>,
        /// La página entera.
        page: Page,
    },

    /// Quita una página con todo lo que lleva. La última no se puede quitar.
    RemovePage {
        /// La página, por su id.
        id: String,
    },

    /// Copia una página detrás de la original, con ids nuevos para todo lo
    /// que lleva dentro.
    DuplicatePage {
        /// La página que se copia.
        id: String,
        /// El id de la copia, que no puede tenerlo nadie más.
        to: String,
    },

    /// Cambia una página de sitio.
    ReorderPage {
        /// La página, por su id.
        id: String,
        /// La posición nueva, contando desde 0.
        index: usize,
    },

    /// Mete varios elementos de una página en un grupo nuevo.
    ///
    /// `rect` es la caja que tendrá el grupo, en mm: la que los contiene a
    /// todos, que es la que enseña el lienzo. Las posiciones de los hijos
    /// pasan a contarse desde esa esquina, así que **no se mueve nada de
    /// sitio**. El grupo queda en la capa del elemento que estaba más
    /// arriba.
    ///
    /// Solo con elementos de la misma página y que no estén ya dentro de
    /// otro grupo.
    Group {
        /// Los elementos, por su id.
        ids: Vec<String>,
        /// El id del grupo nuevo, que no puede tenerlo nadie más.
        id: String,
        /// La caja del grupo, en mm.
        rect: MmRect,
    },

    /// Deshace un grupo: sus hijos vuelven a la página, en su sitio y en su
    /// capa.
    Ungroup {
        /// El grupo, por su id.
        id: String,
    },

    /// Varios comandos como uno solo: se aplican en orden y se deshacen
    /// juntos, del último al primero.
    ///
    /// Es lo que hace falta para mover o redimensionar varios elementos a
    /// la vez: un único cambio del documento, una única compilación y un
    /// único paso del historial. Si uno falla no se aplica ninguno.
    /// Crea un flujo vacío.
    CreateFlow {
        /// Cómo se llama.
        name: String,
        /// El flujo: su texto, su estilo y su cadena.
        flow: Flow,
    },

    /// Quita un flujo que ya no pasa por ninguna zona.
    RemoveFlow {
        /// Cuál.
        name: String,
    },

    /// Pone una zona en la cadena de un flujo.
    LinkZone {
        /// El flujo.
        flow: String,
        /// La zona.
        zone: String,
        /// En qué posición de la cadena, o al final si no se dice.
        index: Option<usize>,
    },

    /// Mete texto en el texto de un flujo.
    InsertFlowText {
        /// El flujo.
        flow: String,
        /// Dónde, en bytes del texto del flujo.
        at: usize,
        /// Lo que se mete.
        text: String,
    },

    /// Borra un tramo del texto de un flujo.
    DeleteFlowText {
        /// El flujo.
        flow: String,
        /// Desde dónde, en bytes.
        from: usize,
        /// Hasta dónde, en bytes, sin incluirlo.
        to: usize,
    },

    /// Cambia el formato de un tramo del texto de un flujo.
    FormatFlowText {
        /// El flujo.
        flow: String,
        /// Desde dónde, en bytes.
        from: usize,
        /// Hasta dónde, en bytes, sin incluirlo.
        to: usize,
        /// Qué se cambia.
        format: Format,
    },

    /// Deja un flujo como estaba: es el deshacer de los cambios de su texto.
    RestoreFlow {
        /// Cuál.
        name: String,
        /// Cómo estaba.
        flow: Flow,
    },

    /// Saca una zona de su cadena y la pasa a un flujo suyo.
    UnlinkZone {
        /// La zona.
        zone: String,
        /// Cómo se llama el flujo nuevo, que se crea aquí.
        to: String,
    },

    Batch {
        /// Los comandos, en el orden en que se aplican.
        ops: Vec<Op>,
    },
}

/// El nombre de un comando compuesto, para el historial.
fn describe_batch(ops: &[Op]) -> String {
    match ops {
        [] => "No hacer nada".to_owned(),
        [only] => only.describe(),
        many if many.iter().all(|op| matches!(op, Op::Move { .. })) => {
            format!("Mover {} elementos", many.len())
        }
        many if many
            .iter()
            .all(|op| matches!(op, Op::Resize { .. } | Op::Restore { .. })) =>
        {
            format!("Redimensionar {} elementos", many.len())
        }
        many => format!("Cambiar {} elementos", many.len()),
    }
}

/// Una propiedad que se puede cambiar con [`Op::SetProperty`], con su valor.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "name", content = "value", rename_all = "snake_case")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = "ops.ts"))]
pub enum Property {
    /// Relleno de un rectángulo o una elipse, o `null` para ninguno.
    Fill(Option<String>),
    /// Borde de un rectángulo o una elipse, o `null` para ninguno. El trazo
    /// de una línea, que no puede ser `null`.
    Stroke(Option<Stroke>),
    /// Radio de las esquinas de un rectángulo, en mm.
    Radius(f64),
    /// Contenido de un texto.
    Content(Vec<Run>),
    /// Estilo de un texto.
    Style(TextStyle),
    /// Código de un bloque de código.
    Source(String),
    /// Imagen de un elemento de imagen, por su clave en `assets`.
    Asset(String),
    /// Nombre del elemento en el panel de capas, o `null` para el que se
    /// deduce de él.
    Name(Option<String>),
    /// Si el elemento está oculto.
    Hidden(bool),
    /// Si el elemento está bloqueado.
    Locked(bool),
}

impl Property {
    /// El nombre de la propiedad, en español, para describir el comando.
    fn label(&self) -> &'static str {
        match self {
            Property::Fill(_) => "el relleno",
            Property::Stroke(_) => "el borde",
            Property::Radius(_) => "el radio",
            Property::Content(_) => "el texto",
            Property::Style(_) => "el estilo",
            Property::Source(_) => "el código",
            Property::Asset(_) => "la imagen",
            Property::Name(_) => "el nombre",
            Property::Hidden(_) => "la visibilidad",
            Property::Locked(_) => "el bloqueo",
        }
    }
}

/// Un comando aplicado: el documento resultante y cómo volver atrás.
#[derive(Debug, Clone, PartialEq)]
pub struct Applied {
    /// El documento con el cambio.
    pub document: Document,
    /// El comando que, aplicado a `document`, deja el documento como estaba.
    pub undo: Op,
}

/// Un comando no se puede aplicar a este documento.
#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum OpError {
    /// No hay ningún elemento con ese id.
    #[error("no hay ningún elemento con el id {id:?}")]
    ElementNotFound {
        /// El id que se pidió.
        id: String,
    },
    /// No hay ninguna página con ese id.
    #[error("no hay ninguna página con el id {id:?}")]
    PageNotFound {
        /// El id que se pidió.
        id: String,
    },
    /// Ya hay un elemento o una página con ese id.
    #[error("ya hay un elemento o una página con el id {id:?}")]
    DuplicateId {
        /// El id repetido.
        id: String,
    },
    /// No hay ningún recurso con esa clave.
    #[error("no hay ningún recurso con la clave {key:?}")]
    AssetNotFound {
        /// La clave que se pidió.
        key: String,
    },
    /// Ya hay un recurso con esa clave.
    #[error("ya hay un recurso con la clave {key:?}")]
    AssetKeyTaken {
        /// La clave repetida.
        key: String,
    },
    /// No hay ninguna variable con ese nombre.
    #[error("el documento no tiene ninguna variable que se llame {name:?}")]
    VariableNotFound {
        /// El nombre que se pidió.
        name: String,
    },
    /// Ya hay una variable con ese nombre.
    #[error("el documento ya tiene una variable que se llama {name:?}")]
    VariableNameTaken {
        /// El nombre repetido.
        name: String,
    },
    /// El nombre no vale: solo letras y dígitos ASCII, guion y guion bajo.
    #[error(
        "el nombre de variable {name:?} no vale: solo puede tener letras y dígitos ASCII, guion y guion bajo"
    )]
    InvalidVariableName {
        /// El nombre pedido.
        name: String,
    },

    /// Un documento sin título no dice qué es.
    #[error("el documento tiene que tener un título")]
    EmptyTitle,

    /// El documento ya declara esa fuente.
    #[error("el documento ya declara la fuente {path:?}")]
    FontAlreadyDeclared {
        /// La ruta.
        path: String,
    },
    /// El documento no declara esa fuente.
    #[error("el documento no declara la fuente {path:?}")]
    FontNotDeclared {
        /// La ruta.
        path: String,
    },
    /// La clave no vale: solo letras y dígitos ASCII, guion y guion bajo.
    #[error(
        "la clave {key:?} no vale: solo puede tener letras y dígitos ASCII, guion y guion bajo"
    )]
    InvalidAssetKey {
        /// La clave pedida.
        key: String,
    },
    /// Un recurso que se quiere quitar lo usan elementos.
    #[error("el recurso {key:?} lo usa{} {}; quítalos o cambia su imagen antes", if users.len() == 1 { "" } else { "n" }, users.join(", "))]
    AssetInUse {
        /// La clave.
        key: String,
        /// Los elementos que lo usan, en orden del documento.
        users: Vec<String>,
    },
    /// El id no vale: solo letras y dígitos ASCII, guion y guion bajo.
    #[error("el id {id:?} no vale: solo puede tener letras y dígitos ASCII, guion y guion bajo")]
    InvalidId {
        /// El id pedido.
        id: String,
    },

    /// El trozo de texto que se pide no está en el texto.
    #[error("{0}")]
    Text(#[from] TextError),

    /// No hay ningún flujo con ese nombre.
    #[error("el documento no tiene ningún flujo que se llame {name:?}")]
    FlowNotFound {
        /// El nombre que se pidió.
        name: String,
    },
    /// Ya hay un flujo con ese nombre.
    #[error("el documento ya tiene un flujo que se llama {name:?}")]
    FlowNameTaken {
        /// El nombre repetido.
        name: String,
    },
    /// Un flujo que se quiere quitar todavía pasa por zonas.
    #[error("el flujo {name:?} todavía pasa por {}; desenlázalas antes", zones.join(", "))]
    FlowInUse {
        /// El nombre.
        name: String,
        /// Las zonas de su cadena, en orden.
        zones: Vec<String>,
    },

    /// El elemento no admite ese cambio.
    #[error("{what} no se puede aplicar a {id:?}, que es un elemento de tipo {kind}")]
    NotApplicable {
        /// El elemento.
        id: String,
        /// Su tipo.
        kind: &'static str,
        /// Qué se intentó.
        what: String,
    },
}

impl Op {
    /// Un nombre legible del comando, para el historial: «Mover r1».
    pub fn describe(&self) -> String {
        match self {
            Op::Move { id, .. } => format!("Mover {id}"),
            Op::Resize { id, .. } => format!("Redimensionar {id}"),
            Op::Rotate { id, .. } => format!("Girar {id}"),
            Op::SetProperty { id, property } => match property {
                Property::Name(_) => format!("Renombrar {id}"),
                Property::Hidden(true) => format!("Ocultar {id}"),
                Property::Hidden(false) => format!("Mostrar {id}"),
                Property::Locked(true) => format!("Bloquear {id}"),
                Property::Locked(false) => format!("Desbloquear {id}"),
                other => format!("Cambiar {} de {id}", other.label()),
            },
            Op::InsertText { id, .. } => format!("Escribir en {id}"),
            Op::DeleteText { id, .. } => format!("Borrar texto de {id}"),
            Op::FormatText { id, .. } => format!("Dar formato a {id}"),
            Op::SetLines { id, line, .. } => match line.list {
                Some(_) => format!("Hacer lista en {id}"),
                None => format!("Quitar la lista de {id}"),
            },
            Op::Create { element, .. } => format!("Crear {}", element.id()),
            Op::Delete { id } => format!("Eliminar {id}"),
            Op::Rename { id, to } => format!("Renombrar {id} a {to}"),
            Op::Reorder { id, .. } => format!("Reordenar {id}"),
            Op::Restore { element } => format!("Restaurar {}", element.id()),
            Op::AddAsset { key, .. } => format!("Añadir el recurso {key}"),
            Op::RemoveAsset { key } => format!("Quitar el recurso {key}"),
            Op::RenameAsset { from, to } => format!("Renombrar el recurso {from} a {to}"),
            Op::SetTitle { .. } => "Cambiar el título".to_owned(),
            Op::SetVariable { name, .. } => format!("Cambiar la variable {name}"),
            Op::RemoveVariable { name } => format!("Quitar la variable {name}"),
            Op::RenameVariable { from, to } => format!("Renombrar la variable {from} a {to}"),
            Op::AddFont { path, .. } => format!("Añadir la fuente {}", file_name(path)),
            Op::RemoveFont { path } => format!("Quitar la fuente {}", file_name(path)),
            Op::InsertPage { page, .. } => format!("Añadir la página {}", page.id),
            Op::RemovePage { id } => format!("Quitar la página {id}"),
            Op::DuplicatePage { id, .. } => format!("Duplicar la página {id}"),
            Op::ReorderPage { id, .. } => format!("Mover la página {id}"),
            Op::Group { ids, .. } => format!("Agrupar {} elementos", ids.len()),
            Op::Ungroup { id } => format!("Desagrupar {id}"),
            Op::CreateFlow { name, .. } => format!("Crear el flujo {name}"),
            Op::RemoveFlow { name } => format!("Quitar el flujo {name}"),
            Op::LinkZone { flow, zone, .. } => format!("Enlazar {zone} con {flow}"),
            Op::UnlinkZone { zone, .. } => format!("Desenlazar {zone}"),
            Op::InsertFlowText { flow, .. } => format!("Escribir en {flow}"),
            Op::DeleteFlowText { flow, .. } => format!("Borrar texto de {flow}"),
            Op::FormatFlowText { flow, .. } => format!("Dar formato a {flow}"),
            Op::RestoreFlow { name, .. } => format!("Restaurar {name}"),
            Op::Batch { ops } => describe_batch(ops),
        }
    }

    /// El id del elemento al que afecta, o `None` si es un cambio de los
    /// recursos del documento.
    pub fn element_id(&self) -> Option<&str> {
        match self {
            Op::Move { id, .. }
            | Op::Resize { id, .. }
            | Op::Rotate { id, .. }
            | Op::SetProperty { id, .. }
            | Op::InsertText { id, .. }
            | Op::DeleteText { id, .. }
            | Op::FormatText { id, .. }
            | Op::SetLines { id, .. }
            | Op::Delete { id }
            | Op::Rename { id, .. }
            | Op::Reorder { id, .. } => Some(id),
            Op::Create { element, .. } | Op::Restore { element } => Some(element.id()),
            Op::Group { id, .. } | Op::Ungroup { id } => Some(id),
            Op::InsertPage { .. }
            | Op::RemovePage { .. }
            | Op::DuplicatePage { .. }
            | Op::ReorderPage { .. }
            | Op::SetTitle { .. }
            | Op::SetVariable { .. }
            | Op::RemoveVariable { .. }
            | Op::RenameVariable { .. }
            | Op::AddAsset { .. }
            | Op::RemoveAsset { .. }
            | Op::RenameAsset { .. }
            | Op::AddFont { .. }
            | Op::RemoveFont { .. }
            | Op::CreateFlow { .. }
            | Op::RemoveFlow { .. }
            | Op::InsertFlowText { .. }
            | Op::DeleteFlowText { .. }
            | Op::FormatFlowText { .. }
            | Op::RestoreFlow { .. } => None,
            Op::LinkZone { zone, .. } | Op::UnlinkZone { zone, .. } => Some(zone),
            // Solo si todos son del mismo elemento.
            Op::Batch { ops } => {
                let first = ops.first()?.element_id()?;
                ops.iter()
                    .all(|op| op.element_id() == Some(first))
                    .then_some(first)
            }
        }
    }

    /// Aplica el comando a una copia del documento.
    ///
    /// # Errores
    ///
    /// [`OpError`] si el comando no se puede aplicar: el documento de
    /// partida no se toca.
    pub fn apply(&self, document: &Document) -> Result<Applied, OpError> {
        let mut document = document.clone();
        let undo = self.apply_in_place(&mut document)?;
        Ok(Applied { document, undo })
    }

    fn apply_in_place(&self, document: &mut Document) -> Result<Op, OpError> {
        match self {
            Op::InsertPage { index, page } => pages::apply_insert(document, *index, page),

            Op::RemovePage { id } => pages::apply_remove(document, id),

            Op::DuplicatePage { id, to } => pages::apply_duplicate(document, id, to),

            Op::ReorderPage { id, index } => pages::apply_reorder(document, id, *index),

            Op::Group { ids, id, rect } => group::apply_group(document, ids, id, *rect),

            Op::Ungroup { id } => group::apply_ungroup(document, id),

            Op::CreateFlow { name, flow } => flow::apply_create(document, name, flow),

            Op::RemoveFlow { name } => flow::apply_remove(document, name),

            Op::LinkZone { flow, zone, index } => flow::apply_link(document, flow, zone, *index),

            Op::UnlinkZone { zone, to } => flow::apply_unlink(document, zone, to),

            Op::InsertFlowText { flow, at, text } => {
                flow::apply_insert_text(document, flow, *at, text)
            }

            Op::DeleteFlowText { flow, from, to } => {
                flow::apply_delete_text(document, flow, *from, *to)
            }

            Op::FormatFlowText {
                flow,
                from,
                to,
                format,
            } => flow::apply_format_text(document, flow, *from, *to, format),

            Op::RestoreFlow { name, flow } => flow::apply_restore(document, name, flow),

            Op::Batch { ops } => {
                let mut undos = Vec::with_capacity(ops.len());
                for op in ops {
                    undos.push(op.apply_in_place(document)?);
                }
                // Se deshacen en el orden contrario al que se aplicaron.
                undos.reverse();
                Ok(Op::Batch { ops: undos })
            }

            Op::Move { id, dx, dy } => edit(document, id, |element| {
                match element {
                    Element::Line { x, y, x2, y2, .. } => {
                        *x += dx;
                        *y += dy;
                        *x2 += dx;
                        *y2 += dy;
                    }
                    other => {
                        if let Some(base) = other.base_mut() {
                            base.x += dx;
                            base.y += dy;
                        }
                    }
                }
                Ok(())
            }),

            Op::Resize { id, x, y, w, h } => edit(document, id, |element| {
                let kind = element.type_name();
                let base = element.base_mut().ok_or_else(|| OpError::NotApplicable {
                    id: id.clone(),
                    kind,
                    what: "Redimensionar".to_owned(),
                })?;
                base.x = *x;
                base.y = *y;
                base.w = *w;
                base.h = *h;
                Ok(())
            }),

            Op::Rotate { id, rotation } => edit(document, id, |element| {
                match element {
                    Element::Line {
                        rotation: current, ..
                    } => *current = *rotation,
                    other => {
                        if let Some(base) = other.base_mut() {
                            base.rotation = *rotation;
                        }
                    }
                }
                Ok(())
            }),

            Op::SetProperty { id, property } => {
                edit(document, id, |element| set_property(element, id, property))
            }

            Op::InsertText { id, at, text } => {
                edit(document, id, |element| text::insert(element, id, *at, text))
            }

            Op::DeleteText { id, from, to } => edit(document, id, |element| {
                text::delete(element, id, *from, *to)
            }),

            Op::FormatText {
                id,
                from,
                to,
                format,
            } => edit(document, id, |element| {
                text::format(element, id, *from, *to, format)
            }),

            Op::SetLines { id, from, to, line } => edit(document, id, |element| {
                text::set_lines(element, id, *from, *to, *line)
            }),

            Op::Create {
                page,
                index,
                element,
            } => {
                let id = element.id();
                if document.element(id).is_some() || document.pages.iter().any(|p| p.id == id) {
                    return Err(OpError::DuplicateId { id: id.to_owned() });
                }
                let target = document
                    .pages
                    .iter_mut()
                    .find(|candidate| candidate.id == *page)
                    .ok_or_else(|| OpError::PageNotFound { id: page.clone() })?;
                let at = index
                    .unwrap_or(target.elements.len())
                    .min(target.elements.len());
                target.elements.insert(at, element.clone());
                Ok(Op::Delete { id: id.to_owned() })
            }

            Op::Delete { id } => {
                let (page, index) = locate(document, id)?;
                // Si es una zona, su cadena no puede quedarse nombrándola:
                // sale de ahí, y deshacer la vuelve a poner donde estaba.
                let place = flow::place_of(document, id);
                flow::unlink_everywhere(document, id);

                let element = document.pages[page].elements.remove(index);
                let create = Op::Create {
                    page: document.pages[page].id.clone(),
                    index: Some(index),
                    element,
                };

                Ok(match place {
                    Some((name, at)) => Op::Batch {
                        ops: vec![
                            create,
                            Op::LinkZone {
                                flow: name,
                                zone: id.clone(),
                                index: Some(at),
                            },
                        ],
                    },
                    None => create,
                })
            }

            Op::Rename { id, to } => {
                let (page, at) = locate(document, id)?;
                if id != to {
                    if !is_valid_id(to) {
                        return Err(OpError::InvalidId { id: to.clone() });
                    }
                    if document.element(to).is_some()
                        || document.pages.iter().any(|page| page.id == *to)
                    {
                        return Err(OpError::DuplicateId { id: to.clone() });
                    }
                    document.pages[page].elements[at].set_id(to.clone());
                }
                Ok(Op::Rename {
                    id: to.clone(),
                    to: id.clone(),
                })
            }

            Op::Reorder { id, index } => {
                let (page, from) = locate(document, id)?;
                let elements = &mut document.pages[page].elements;
                let element = elements.remove(from);
                let to = (*index).min(elements.len());
                elements.insert(to, element);
                Ok(Op::Reorder {
                    id: id.clone(),
                    index: from,
                })
            }

            Op::Restore { element } => {
                // Vale también dentro de un grupo, como `edit`.
                let target =
                    find_mut(document, element.id()).ok_or_else(|| OpError::ElementNotFound {
                        id: element.id().to_owned(),
                    })?;
                let previous = std::mem::replace(target, element.clone());
                Ok(Op::Restore { element: previous })
            }

            Op::AddAsset { key, path } => {
                check_asset_key(document, key)?;
                document.assets.insert(key.clone(), path.clone());
                Ok(Op::RemoveAsset { key: key.clone() })
            }

            Op::RemoveAsset { key } => {
                if !document.assets.contains_key(key) {
                    return Err(OpError::AssetNotFound { key: key.clone() });
                }
                let users = document.asset_users(key);
                if !users.is_empty() {
                    return Err(OpError::AssetInUse {
                        key: key.clone(),
                        users,
                    });
                }
                let path = document.assets.remove(key).unwrap_or_default();
                Ok(Op::AddAsset {
                    key: key.clone(),
                    path,
                })
            }

            Op::SetTitle { title } => {
                let title = title.trim();
                if title.is_empty() {
                    return Err(OpError::EmptyTitle);
                }
                let previous = std::mem::replace(&mut document.meta.title, title.to_owned());
                Ok(Op::SetTitle { title: previous })
            }

            Op::SetVariable { name, variable } => {
                check_variable_name(name)?;
                let previous = document.variables.insert(name.clone(), variable.clone());
                Ok(match previous {
                    Some(variable) => Op::SetVariable {
                        name: name.clone(),
                        variable,
                    },
                    None => Op::RemoveVariable { name: name.clone() },
                })
            }

            Op::RemoveVariable { name } => {
                let variable = document
                    .variables
                    .remove(name)
                    .ok_or_else(|| OpError::VariableNotFound { name: name.clone() })?;
                Ok(Op::SetVariable {
                    name: name.clone(),
                    variable,
                })
            }

            Op::RenameVariable { from, to } => {
                if !document.variables.contains_key(from) {
                    return Err(OpError::VariableNotFound { name: from.clone() });
                }
                if from != to {
                    check_variable_name(to)?;
                    if document.variables.contains_key(to) {
                        return Err(OpError::VariableNameTaken { name: to.clone() });
                    }
                    let variable = document.variables.remove(from).unwrap_or_default();
                    document.variables.insert(to.clone(), variable);
                    // Y donde se usaba: renombrar una variable no puede
                    // dejar el documento señalando a una que ya no está.
                    variables::rename_in(document, from, to);
                }
                Ok(Op::RenameVariable {
                    from: to.clone(),
                    to: from.clone(),
                })
            }

            Op::AddFont { path, index } => {
                if document.fonts.contains(path) {
                    return Err(OpError::FontAlreadyDeclared { path: path.clone() });
                }
                let at = index
                    .unwrap_or(document.fonts.len())
                    .min(document.fonts.len());
                document.fonts.insert(at, path.clone());
                Ok(Op::RemoveFont { path: path.clone() })
            }

            Op::RemoveFont { path } => {
                let at = document
                    .fonts
                    .iter()
                    .position(|font| font == path)
                    .ok_or_else(|| OpError::FontNotDeclared { path: path.clone() })?;
                document.fonts.remove(at);
                Ok(Op::AddFont {
                    path: path.clone(),
                    index: Some(at),
                })
            }

            Op::RenameAsset { from, to } => {
                if !document.assets.contains_key(from) {
                    return Err(OpError::AssetNotFound { key: from.clone() });
                }
                if from != to {
                    check_asset_key(document, to)?;
                    let path = document.assets.remove(from).unwrap_or_default();
                    document.assets.insert(to.clone(), path);
                    for element in document
                        .pages
                        .iter_mut()
                        .flat_map(|page| &mut page.elements)
                    {
                        if let Element::Image { asset, .. } = element
                            && asset == from
                        {
                            asset.clone_from(to);
                        }
                    }
                }
                Ok(Op::RenameAsset {
                    from: to.clone(),
                    to: from.clone(),
                })
            }
        }
    }
}

/// El nombre del archivo de una ruta con `/`: «Inter-Regular.ttf».
fn file_name(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

/// El nombre de una variable se escribe en el código generado, así que
/// tiene las mismas reglas que un id.
fn check_variable_name(name: &str) -> Result<(), OpError> {
    if is_valid_id(name) {
        Ok(())
    } else {
        Err(OpError::InvalidVariableName {
            name: name.to_owned(),
        })
    }
}

/// Una clave nueva de `assets` tiene que ser válida y no estar usada.
fn check_asset_key(document: &Document, key: &str) -> Result<(), OpError> {
    if !is_valid_id(key) {
        return Err(OpError::InvalidAssetKey {
            key: key.to_owned(),
        });
    }
    if document.assets.contains_key(key) {
        return Err(OpError::AssetKeyTaken {
            key: key.to_owned(),
        });
    }
    Ok(())
}

/// Cambia un elemento en su sitio y devuelve el [`Op::Restore`] con cómo
/// estaba. Si `change` falla, el elemento queda como estaba.
///
/// Vale también para un elemento **dentro de un grupo**: se busca por todo
/// el árbol, así que entrar en un grupo y mover o escribir en un hijo es un
/// comando como cualquier otro.
fn edit(
    document: &mut Document,
    id: &str,
    change: impl FnOnce(&mut Element) -> Result<(), OpError>,
) -> Result<Op, OpError> {
    let element =
        find_mut(document, id).ok_or_else(|| OpError::ElementNotFound { id: id.to_owned() })?;
    let previous = element.clone();
    if let Err(error) = change(element) {
        *element = previous;
        return Err(error);
    }
    Ok(Op::Restore { element: previous })
}

/// Por dónde se llega a un elemento: su página y, dentro de ella, el índice
/// en cada nivel de grupos.
fn path_of(document: &Document, id: &str) -> Option<(usize, Vec<usize>)> {
    fn inside(elements: &[Element], id: &str) -> Option<Vec<usize>> {
        for (index, element) in elements.iter().enumerate() {
            if element.id() == id {
                return Some(vec![index]);
            }
            if let Some(mut deeper) = inside(element.children(), id) {
                deeper.insert(0, index);
                return Some(deeper);
            }
        }
        None
    }
    document
        .pages
        .iter()
        .enumerate()
        .find_map(|(page, content)| inside(&content.elements, id).map(|path| (page, path)))
}

/// El elemento al que lleva ese camino, para cambiarlo.
fn find_mut<'a>(document: &'a mut Document, id: &str) -> Option<&'a mut Element> {
    let (page, path) = path_of(document, id)?;
    let (first, rest) = path.split_first()?;
    let mut element = document.pages.get_mut(page)?.elements.get_mut(*first)?;
    for index in rest {
        element = match element {
            Element::Group { children, .. } => children.get_mut(*index)?,
            _ => return None,
        };
    }
    Some(element)
}

/// En qué página y en qué posición está un elemento.
fn locate(document: &Document, id: &str) -> Result<(usize, usize), OpError> {
    document
        .pages
        .iter()
        .enumerate()
        .find_map(|(page, content)| {
            content
                .elements
                .iter()
                .position(|element| element.id() == id)
                .map(|index| (page, index))
        })
        .ok_or_else(|| OpError::ElementNotFound { id: id.to_owned() })
}

fn set_property(element: &mut Element, id: &str, property: &Property) -> Result<(), OpError> {
    let kind = element.type_name();
    let not_applicable = || OpError::NotApplicable {
        id: id.to_owned(),
        kind,
        what: format!("Cambiar {}", property.label()),
    };

    // Lo del panel de capas vale para cualquier tipo. `false` no se
    // escribe: un elemento que se oculta y se vuelve a mostrar deja el JSON
    // como estaba.
    match property {
        Property::Name(value) => {
            element.layer_mut().name = value.clone().filter(|name| !name.trim().is_empty());
            return Ok(());
        }
        Property::Hidden(value) => {
            element.layer_mut().hidden = value.then_some(true);
            return Ok(());
        }
        Property::Locked(value) => {
            element.layer_mut().locked = value.then_some(true);
            return Ok(());
        }
        _ => {}
    }

    match (element, property) {
        (Element::Rect { fill, .. } | Element::Ellipse { fill, .. }, Property::Fill(value)) => {
            fill.clone_from(value);
        }
        (
            Element::Rect { stroke, .. } | Element::Ellipse { stroke, .. },
            Property::Stroke(value),
        ) => {
            stroke.clone_from(value);
        }
        (Element::Line { stroke, .. }, Property::Stroke(Some(value))) => *stroke = value.clone(),
        (Element::Rect { radius, .. }, Property::Radius(value)) => *radius = *value,
        (Element::Text { content, .. }, Property::Content(value)) => content.clone_from(value),
        (Element::Text { style, .. }, Property::Style(value)) => *style = value.clone(),
        (Element::Code { source, .. }, Property::Source(value)) => source.clone_from(value),
        (Element::Image { asset, .. }, Property::Asset(value)) => asset.clone_from(value),
        _ => return Err(not_applicable()),
    }
    Ok(())
}

#[cfg(test)]
mod tests;
