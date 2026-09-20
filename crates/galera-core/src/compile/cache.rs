//! Compilar muchas veces seguidas sin empezar de cero cada vez.
//!
//! Escribir recompila en cada tecla. Una compilación desde cero lee las
//! fuentes del disco, construye el índice tipográfico, analiza el código
//! entero y compone todas las páginas; hacerlo sesenta veces por minuto no
//! cabe en el presupuesto de la fase (menos de 50 ms entre tecla y render).
//!
//! [`Compiler`] guarda el entorno entre compilaciones y solo rehace lo que
//! haya cambiado:
//!
//! - **El mundo y las fuentes se reutilizan.** Se cargan una vez por
//!   proyecto abierto, no una vez por tecla. Solo se rehacen si el documento
//!   declara otras fuentes.
//! - **El código se cambia por dentro** ([`GaleraWorld::set_main`]): Typst
//!   busca el trozo que cambió y vuelve a analizar solo ese, en vez de
//!   partir de cero.
//! - **Lo que Typst ya calculó se reutiliza.** Typst memoiza su trabajo con
//!   `comemo`, indexado por lo que entra: si el párrafo de la página cuatro
//!   no ha cambiado, no se vuelve a componer. Eso funciona solo si el mundo
//!   sigue vivo entre compilaciones, que es justo lo que hace este módulo.
//!
//! # Lo que se tira, y cuándo
//!
//! | Cambia | Qué se rehace |
//! |---|---|
//! | El texto, una caja, un color | Solo lo que toca: el resto se reutiliza |
//! | Las fuentes que declara el documento | El mundo entero, fuentes incluidas |
//! | Un archivo del proyecto (una imagen nueva) | Las lecturas: [`Compiler::forget_files`] |
//! | El proyecto abierto | Otro [`Compiler`] |
//!
//! La caché de `comemo` se poda después de cada compilación
//! (`EVICT_MAX_AGE`): lo que no se usa en unas cuantas compilaciones se
//! suelta, para que escribir un rato largo no se coma la memoria.
//!
//! # Medido
//!
//! Ver `docs/decisiones/compilacion-incremental.md` y el banco de pruebas
//! `benches/compile.rs`.

use std::collections::HashMap;
use std::sync::Arc;

use typst::diag::Warned;
use typst::utils::hash128;
use typst_layout::PagedDocument;

use super::{Compiled, diagnostics};
use crate::codegen;
use crate::error::{GaleraError, Result};
use crate::model::Document;
use crate::project::Project;
use crate::world::GaleraWorld;

/// Cuántas compilaciones sobrevive lo memoizado sin que nadie lo use.
///
/// Con 5, escribir una frase conserva lo de las páginas que no se tocan y
/// suelta lo que dejó de valer hace rato. Es lo que usa la herramienta de
/// terminal de Typst en su modo de vigilancia.
const EVICT_MAX_AGE: usize = 5;

/// Compila un proyecto muchas veces, reutilizando lo que pueda.
///
/// Se crea uno por proyecto abierto y se guarda mientras dure. Cada
/// compilación necesita `&mut` porque cambia el código del mundo por
/// dentro: quien lo comparta entre hilos lo protege, y así además dos
/// compilaciones no se pisan.
pub struct Compiler {
    /// La carpeta del proyecto.
    project: Project,
    /// El entorno, con sus fuentes. Se crea en la primera compilación, que
    /// es cuando se sabe qué fuentes declara el documento.
    world: Option<GaleraWorld>,
    /// Las fuentes con las que se construyó el entorno.
    fonts: Vec<String>,
    /// Cuántas veces se ha construido el entorno desde que se creó.
    builds: usize,
    /// El SVG de cada página dibujada, por la huella de su página. Solo se
    /// guardan las de la última compilación.
    svgs: HashMap<u128, Arc<str>>,
    /// Cuántas páginas se han dibujado de verdad desde que se creó.
    rendered: usize,
}

impl Compiler {
    /// Prepara el compilador de un proyecto. No lee nada todavía.
    pub fn new(project: Project) -> Self {
        Self {
            project,
            world: None,
            fonts: Vec::new(),
            builds: 0,
            svgs: HashMap::new(),
            rendered: 0,
        }
    }

    /// La carpeta del proyecto.
    pub fn project(&self) -> &Project {
        &self.project
    }

    /// Olvida los archivos del proyecto que ya se habían leído.
    ///
    /// Hace falta cuando cambian en disco mientras el proyecto está
    /// abierto: una imagen que se importa, una fuente que se añade.
    pub fn forget_files(&self) {
        if let Some(world) = &self.world {
            world.clear_file_cache();
        }
    }

    /// El SVG de cada página, reutilizando el de la compilación anterior
    /// en las que no han cambiado.
    ///
    /// Dibujar una página cuesta bastante más que compararla: al escribir,
    /// solo cambia la página que se está tocando, y las demás se devuelven
    /// tal cual salieron la vez anterior. Dos páginas idénticas —una
    /// plantilla repetida— comparten dibujo.
    ///
    /// `compiled` tiene que salir de este mismo compilador.
    pub fn page_svgs(&mut self, compiled: &Compiled) -> Vec<String> {
        let pages = compiled.paged().pages();
        let mut fresh = HashMap::with_capacity(pages.len());
        let mut out = Vec::with_capacity(pages.len());

        for (index, page) in pages.iter().enumerate() {
            // La huella de la página: lo que se dibuja y dónde. Una página
            // que no ha cambiado da la misma.
            let key = hash128(&page.frame);
            let svg = match self.svgs.get(&key).or_else(|| fresh.get(&key)) {
                Some(svg) => Arc::clone(svg),
                None => {
                    self.rendered += 1;
                    // La página existe: el índice sale de recorrerlas.
                    let svg = compiled.to_svg(index).unwrap_or_default();
                    Arc::from(svg)
                }
            };
            fresh.insert(key, Arc::clone(&svg));
            out.push(svg.to_string());
        }

        // Solo las de ahora: así no crece sin parar al escribir.
        self.svgs = fresh;
        out
    }

    /// Cuántas páginas se han dibujado de verdad, sin contar las
    /// reutilizadas.
    pub fn pages_rendered(&self) -> usize {
        self.rendered
    }

    /// Cuántas veces se ha construido el entorno, con sus fuentes. Una por
    /// proyecto abierto, salvo que el documento cambie de fuentes.
    pub fn worlds_built(&self) -> usize {
        self.builds
    }

    /// Compila el documento, reutilizando lo que valga de la vez anterior.
    ///
    /// # Errores
    ///
    /// Los mismos que [`super::compile`].
    pub fn compile(&mut self, document: &Document) -> Result<Compiled> {
        document.validate()?;
        let code = codegen::generate(document)?;

        // El mundo lleva las fuentes dentro: si el documento declara otras,
        // no vale reutilizarlo.
        match &mut self.world {
            Some(world) if self.fonts == document.fonts => world.set_main(&code),
            slot => {
                *slot = Some(GaleraWorld::new(
                    self.project.clone(),
                    &document.fonts,
                    code,
                )?);
                self.fonts = document.fonts.clone();
                self.builds += 1;
            }
        }
        let Some(world) = &self.world else {
            unreachable!("se acaba de poner");
        };

        // Las familias solo se conocen con las fuentes ya leídas. Sin esto,
        // una familia que no está sería un aviso de Typst y el texto saldría
        // con otra fuente, sin que nadie se enterase (principio 4).
        document.validate_font_families(&world.font_families())?;

        // Se guarda el código generado para atribuir diagnósticos también
        // después, al exportar, cuando el entorno ya no existe.
        let source = world.main_source();

        let Warned { output, warnings } = typst::compile::<PagedDocument>(world);
        // Podar después de compilar, no antes: lo que se acaba de usar tiene
        // que seguir contando como reciente.
        comemo::evict(EVICT_MAX_AGE);

        let warnings = diagnostics(&source, &warnings);
        let document =
            output.map_err(|errors| GaleraError::Typst(diagnostics(&source, &errors)))?;

        Ok(Compiled {
            document,
            warnings,
            source,
        })
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::time::{Duration, Instant};

    use tempfile::TempDir;

    use super::*;
    use crate::model::{Element, TextStyle};

    /// Lo que puede tardar un cambio de una letra en un documento de cinco
    /// páginas, con la caché puesta.
    ///
    /// El objetivo de la fase son 50 ms entre tecla y render, medidos con el
    /// binario optimizado (ver `benches/compile.rs` y
    /// `docs/decisiones/compilacion-incremental.md`). Las pruebas corren sin
    /// optimizar, así que este presupuesto es otro: holgado, para que no
    /// falle por ir la máquina cargada, pero lo bastante ajustado como para
    /// que una compilación desde cero —que tarda de sobra más que esto— no
    /// pase.
    const BUDGET: Duration = Duration::from_millis(250);

    /// Un proyecto temporal con una fuente de verdad.
    fn project_dir() -> TempDir {
        let dir = TempDir::new().expect("carpeta temporal");
        fs::create_dir(dir.path().join("fonts")).expect("fonts/");
        let font = typst_assets::fonts()
            .next()
            .expect("typst-assets trae fuentes con la característica `fonts`");
        fs::write(dir.path().join("fonts/LibertinusSerif-Regular.otf"), font).expect("la fuente");
        dir
    }

    fn open(dir: &TempDir) -> Project {
        Project::open(dir.path()).expect("el proyecto debe abrirse")
    }

    /// Un documento de cinco páginas con un párrafo largo en cada una.
    fn five_pages(text: &str) -> Document {
        let page = |number: usize| {
            format!(
                r##"{{ "id": "p{number}", "size": {{ "width": 210, "height": 297, "unit": "mm" }},
                       "elements": [
                         {{ "id": "t{number}", "type": "text", "x": 20, "y": 20, "w": 170, "h": null,
                            "content": [{{ "text": "{text} {}" }}],
                            "style": {{ "font": "Libertinus Serif", "size": 11, "color": "#1F2733",
                                       "align": "justify", "leading": 0.65 }} }}
                       ] }}"##,
                format!("{} ", text.repeat(3)).repeat(40),
            )
        };
        let pages: Vec<String> = (1..=5).map(page).collect();
        Document::from_json_str(&format!(
            r##"{{
              "version": 1,
              "meta": {{ "title": "Cinco páginas" }},
              "fonts": ["fonts/LibertinusSerif-Regular.otf"],
              "pages": [{}]
            }}"##,
            pages.join(",")
        ))
        .expect("es un documento")
    }

    /// Cambia una letra del texto de la última página.
    fn type_a_letter(document: &mut Document, letter: char) {
        let page = document.pages.last_mut().expect("hay páginas");
        if let Some(Element::Text { content, .. }) = page.elements.first_mut() {
            content[0].text.push(letter);
        }
    }

    /// Lo que tarda cada tecla de una tanda: el camino entero de la app,
    /// el mismo que mide `benches/compile.rs`.
    fn typing(compiler: &mut Compiler, document: &mut Document, keys: usize) -> Vec<Duration> {
        ('a'..)
            .take(keys)
            .map(|letter| {
                type_a_letter(document, letter);
                let started = Instant::now();
                let compiled = compiler.compile(document).expect("compila");
                compiler.page_svgs(&compiled);
                compiled.layout();
                compiled.glyphs(document, "t5");
                started.elapsed()
            })
            .collect()
    }

    fn median(mut times: Vec<Duration>) -> Duration {
        times.sort_unstable();
        times[times.len() / 2]
    }

    /// El criterio de la tarea: escribir en un documento de cinco páginas
    /// cabe en el presupuesto, y se mide.
    ///
    /// Lo que se mide es el camino entero de una tecla: compilar y dibujar
    /// las páginas, que es lo que hace la app en cada cambio.
    #[test]
    fn typing_in_five_pages_stays_within_budget() {
        let dir = project_dir();
        let project = open(&dir);
        let mut document = five_pages("Cooperativa agrícola del este");

        // Desde cero, como si se abriera el documento en cada tecla, que es
        // lo que se hacía antes de este módulo. Cada vez con una letra más:
        // así ninguna de las dos tandas compila dos veces lo mismo.
        let fresh = median(
            ('A'..)
                .take(5)
                .map(|letter| {
                    type_a_letter(&mut document, letter);
                    let started = Instant::now();
                    let compiled = crate::compile(&document, &project).expect("compila");
                    for page in 0..compiled.page_count() {
                        compiled.to_svg(page).expect("svg");
                    }
                    started.elapsed()
                })
                .collect(),
        );

        let mut compiler = Compiler::new(project);
        let first = compiler.compile(&document).expect("la primera compila");
        compiler.page_svgs(&first);
        let cached = median(typing(&mut compiler, &mut document, 7));

        println!("una tecla · desde cero: {fresh:?} · con caché: {cached:?}");
        assert!(
            cached < BUDGET,
            "una tecla tarda {cached:?}, más que el presupuesto de {BUDGET:?}"
        );
        assert_eq!(
            compiler.worlds_built(),
            1,
            "el entorno se construye una vez"
        );
    }

    /// El criterio de la tarea: al escribir solo se vuelve a dibujar la
    /// página que ha cambiado.
    #[test]
    fn only_the_page_that_changed_is_drawn_again() {
        let dir = project_dir();
        let mut document = five_pages("Cinco páginas");
        let mut compiler = Compiler::new(open(&dir));

        let compiled = compiler.compile(&document).expect("compila");
        let first = compiler.page_svgs(&compiled);
        assert_eq!(compiler.pages_rendered(), 5, "la primera vez, todas");

        type_a_letter(&mut document, 'x');
        let compiled = compiler.compile(&document).expect("compila");
        let second = compiler.page_svgs(&compiled);
        assert_eq!(compiler.pages_rendered(), 6, "solo la que cambió");

        // Y lo que se devuelve es lo mismo que dibujar cada página.
        assert_eq!(second.len(), 5);
        assert_eq!(second[0], first[0], "las que no cambian salen igual");
        assert_ne!(second[4], first[4], "la que cambia, no");
        for (page, svg) in second.iter().enumerate() {
            assert_eq!(*svg, compiled.to_svg(page).expect("svg"));
        }
    }

    /// Reutilizar el entorno no cambia lo que sale: el mismo documento
    /// compila igual con caché y sin ella.
    #[test]
    fn the_cache_does_not_change_what_comes_out() {
        let dir = project_dir();
        let project = open(&dir);
        let mut document = five_pages("Texto de prueba");

        let mut compiler = Compiler::new(project.clone());
        compiler.compile(&document).expect("la primera compila");
        type_a_letter(&mut document, 'x');

        let cached = compiler.compile(&document).expect("compila");
        let fresh = crate::compile(&document, &project).expect("compila");
        assert_eq!(cached.page_count(), fresh.page_count());
        assert_eq!(cached.layout(), fresh.layout());
        assert_eq!(
            cached.to_svg(0).expect("página 0"),
            fresh.to_svg(0).expect("página 0")
        );
    }

    /// Cambiar las fuentes que declara el documento rehace el entorno: las
    /// fuentes viven dentro de él.
    #[test]
    fn changing_the_declared_fonts_rebuilds_the_world() {
        let dir = project_dir();
        let mut document = five_pages("Con fuente");
        let mut compiler = Compiler::new(open(&dir));
        compiler.compile(&document).expect("compila");

        // Una fuente que no está: el error es del entorno, no de Typst.
        document.fonts = vec!["fonts/NoEstá.otf".to_owned()];
        match compiler.compile(&document) {
            Err(error) => assert!(
                matches!(error, GaleraError::World(_)),
                "tendría que quejarse de la fuente: {error}"
            ),
            Ok(_) => panic!("sin la fuente no debería compilar"),
        }

        // Y al volver a la de antes, sigue compilando.
        document.fonts = vec!["fonts/LibertinusSerif-Regular.otf".to_owned()];
        compiler.compile(&document).expect("vuelve a compilar");
    }

    /// El criterio de la tarea: si un archivo del proyecto cambia en disco,
    /// la caché se entera cuando se le dice.
    #[test]
    fn forgetting_the_files_picks_up_the_new_ones() {
        let dir = project_dir();
        fs::create_dir(dir.path().join("assets")).expect("assets/");
        let image = dir.path().join("assets/imagen.svg");
        let svg = |width: u32, height: u32| {
            format!(
                r#"<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}"><rect width="{width}" height="{height}" fill="black"/></svg>"#
            )
        };
        fs::write(&image, svg(10, 10)).expect("escribir la imagen");

        let document = Document::from_json_str(
            r##"{
              "version": 1,
              "meta": { "title": "Imagen" },
              "fonts": ["fonts/LibertinusSerif-Regular.otf"],
              "assets": { "logo": "assets/imagen.svg" },
              "pages": [{ "id": "p1", "size": { "width": 100, "height": 100, "unit": "mm" },
                          "elements": [
                            { "id": "i1", "type": "image", "x": 10, "y": 10, "w": 50, "h": null,
                              "asset": "logo" }
                          ] }]
            }"##,
        )
        .expect("es un documento");

        let mut compiler = Compiler::new(open(&dir));
        let before = compiler.compile(&document).expect("compila").layout();
        assert_eq!(before[0].h, 50.0, "cuadrada: {before:?}");

        // La misma imagen, con otra forma. Sin olvidar las lecturas, se
        // seguiría viendo la de antes.
        fs::write(&image, svg(10, 5)).expect("cambiar la imagen");
        let stale = compiler.compile(&document).expect("compila").layout();
        assert_eq!(stale[0].h, 50.0, "todavía la de antes: {stale:?}");

        compiler.forget_files();
        let after = compiler.compile(&document).expect("compila").layout();
        assert_eq!(after[0].h, 25.0, "la nueva mide la mitad: {after:?}");
    }

    /// Un texto vacío en el estilo sigue siendo un error de validación, con
    /// caché o sin ella: reutilizar no se salta la validación.
    #[test]
    fn the_document_is_still_validated_every_time() {
        let dir = project_dir();
        let mut document = five_pages("Válido");
        let mut compiler = Compiler::new(open(&dir));
        compiler.compile(&document).expect("compila");

        if let Some(Element::Text {
            style: TextStyle { size, .. },
            ..
        }) = document.pages[0].elements.first_mut()
        {
            *size = -1.0;
        }
        match compiler.compile(&document) {
            Err(error) => assert!(matches!(error, GaleraError::Invalid(_)), "{error}"),
            Ok(_) => panic!("un tamaño negativo no debería compilar"),
        }
    }
}
