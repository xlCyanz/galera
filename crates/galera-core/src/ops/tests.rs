use serde_json::json;

use super::*;
use crate::model::{ListKind, Stroke};

/// Una página con un rectángulo, una línea, un texto, una imagen y un bloque
/// de código; y otra página vacía.
fn document() -> Document {
    Document::from_json_str(
        r##"{
          "version": 1,
          "meta": { "title": "Ops" },
          "assets": { "logo": "assets/logo.png", "otro": "assets/pixel.png" },
          "pages": [
            { "id": "p1", "size": { "width": 210, "height": 297, "unit": "mm" }, "elements": [
              { "id": "r1", "type": "rect", "x": 10, "y": 20, "w": 30, "h": 40,
                "fill": "#ff0000", "stroke": null },
              { "id": "l1", "type": "line", "x": 5, "y": 6, "x2": 50, "y2": 60,
                "stroke": { "color": "#000000", "width": 0.5 } },
              { "id": "t1", "type": "text", "x": 20, "y": 100, "w": 80, "h": null,
                "content": [{ "text": "Hola" }],
                "style": { "font": "Inter", "size": 12, "color": "#000000" } },
              { "id": "i1", "type": "image", "x": 20, "y": 150, "w": 40, "h": null, "asset": "logo" },
              { "id": "c1", "type": "code", "x": 20, "y": 200, "w": 100, "h": 20, "source": "#lorem(5)" }
            ] },
            { "id": "p2", "size": { "width": 210, "height": 297, "unit": "mm" }, "elements": [] }
          ]
        }"##,
    )
    .expect("es un documento")
}

/// Aplica un comando, comprueba que su `undo` deja el documento exactamente
/// como estaba, y devuelve el resultado.
fn apply_and_check_undo(op: &Op) -> Document {
    let original = document();
    let applied = op
        .apply(&original)
        .unwrap_or_else(|error| panic!("{op:?}: {error}"));
    assert_ne!(applied.document, original, "{op:?} no ha cambiado nada");
    let restored = applied
        .undo
        .apply(&applied.document)
        .expect("el undo se aplica");
    assert_eq!(restored.document, original, "deshacer {op:?}");
    applied.document
}

fn element<'a>(document: &'a Document, id: &str) -> &'a Element {
    document.element(id).unwrap_or_else(|| panic!("falta {id}"))
}

fn ids(document: &Document, page: usize) -> Vec<&str> {
    document.pages[page]
        .elements
        .iter()
        .map(Element::id)
        .collect()
}

#[test]
fn move_shifts_a_box() {
    let document = apply_and_check_undo(&Op::Move {
        id: "r1".into(),
        dx: 5.0,
        dy: -2.5,
    });
    let base = element(&document, "r1").base().expect("caja");
    assert_eq!(
        (base.x, base.y, base.w, base.h),
        (15.0, 17.5, 30.0, Some(40.0))
    );
}

#[test]
fn move_shifts_both_ends_of_a_line() {
    let document = apply_and_check_undo(&Op::Move {
        id: "l1".into(),
        dx: 1.0,
        dy: 2.0,
    });
    let Element::Line { x, y, x2, y2, .. } = element(&document, "l1") else {
        panic!("es una línea");
    };
    assert_eq!((*x, *y, *x2, *y2), (6.0, 8.0, 51.0, 62.0));
}

#[test]
fn resize_sets_the_box() {
    let document = apply_and_check_undo(&Op::Resize {
        id: "t1".into(),
        x: 1.0,
        y: 2.0,
        w: 3.0,
        h: Some(4.0),
    });
    let base = element(&document, "t1").base().expect("caja");
    assert_eq!((base.x, base.y, base.w, base.h), (1.0, 2.0, 3.0, Some(4.0)));

    // Y se puede volver al alto automático.
    let automatic = Op::Resize {
        id: "r1".into(),
        x: 10.0,
        y: 20.0,
        w: 30.0,
        h: None,
    };
    let document = apply_and_check_undo(&automatic);
    assert_eq!(element(&document, "r1").base().expect("caja").h, None);
}

#[test]
fn a_line_is_not_resized() {
    let error = Op::Resize {
        id: "l1".into(),
        x: 0.0,
        y: 0.0,
        w: 1.0,
        h: None,
    }
    .apply(&document())
    .expect_err("una línea no tiene caja");
    assert_eq!(
        error,
        OpError::NotApplicable {
            id: "l1".into(),
            kind: "line",
            what: "Redimensionar".into()
        }
    );
}

#[test]
fn rotate_sets_the_angle_of_boxes_and_lines() {
    let document = apply_and_check_undo(&Op::Rotate {
        id: "r1".into(),
        rotation: 30.0,
    });
    assert_eq!(element(&document, "r1").rotation(), 30.0);
    let document = apply_and_check_undo(&Op::Rotate {
        id: "l1".into(),
        rotation: -15.0,
    });
    assert_eq!(element(&document, "l1").rotation(), -15.0);
}

#[test]
fn every_property_changes_where_it_applies() {
    let stroke = Stroke {
        color: "#00ff00".into(),
        width: 2.0,
        dash: Some(crate::model::Dash::Dotted),
    };
    let cases = [
        ("r1", Property::Fill(None)),
        ("r1", Property::Stroke(Some(stroke.clone()))),
        ("r1", Property::Radius(3.0)),
        ("l1", Property::Stroke(Some(stroke.clone()))),
        ("t1", Property::Content(vec![Run::plain("Adiós")])),
        (
            "t1",
            Property::Style(TextStyle {
                font: "Inter".into(),
                size: 20.0,
                color: "#0000ff".into(),
                align: crate::model::Align::Center,
                leading: 1.0,
                spacing: None,
            }),
        ),
        ("c1", Property::Source("#lorem(10)".into())),
        ("i1", Property::Asset("otro".into())),
    ];
    for (id, property) in cases {
        let op = Op::SetProperty {
            id: id.into(),
            property,
        };
        apply_and_check_undo(&op);
    }
}

#[test]
fn a_property_the_element_does_not_have_is_refused() {
    let refused = [
        ("t1", Property::Fill(Some("#ff0000".into()))),
        ("r1", Property::Source("x".into())),
        ("i1", Property::Radius(2.0)),
        // Una línea siempre tiene trazo: no se le puede quitar.
        ("l1", Property::Stroke(None)),
    ];
    for (id, property) in refused {
        let op = Op::SetProperty {
            id: id.into(),
            property,
        };
        assert!(
            matches!(op.apply(&document()), Err(OpError::NotApplicable { .. })),
            "{op:?}"
        );
    }
}

#[test]
fn create_puts_the_element_on_top_or_where_asked() {
    let new = |id: &str| -> Element {
        serde_json::from_value(json!({
            "id": id, "type": "rect", "x": 0, "y": 0, "w": 1, "h": 1, "fill": null, "stroke": null
        }))
        .expect("es un elemento")
    };

    let on_top = apply_and_check_undo(&Op::Create {
        page: "p1".into(),
        index: None,
        element: new("n1"),
    });
    assert_eq!(ids(&on_top, 0).last(), Some(&"n1"));

    let below = apply_and_check_undo(&Op::Create {
        page: "p1".into(),
        index: Some(0),
        element: new("n2"),
    });
    assert_eq!(ids(&below, 0).first(), Some(&"n2"));

    let other_page = apply_and_check_undo(&Op::Create {
        page: "p2".into(),
        index: None,
        element: new("n3"),
    });
    assert_eq!(ids(&other_page, 1), ["n3"]);

    assert_eq!(
        Op::Create {
            page: "p1".into(),
            index: None,
            element: new("r1")
        }
        .apply(&document()),
        Err(OpError::DuplicateId { id: "r1".into() })
    );
    assert_eq!(
        Op::Create {
            page: "p1".into(),
            index: None,
            element: new("p2")
        }
        .apply(&document()),
        Err(OpError::DuplicateId { id: "p2".into() })
    );
    assert_eq!(
        Op::Create {
            page: "nada".into(),
            index: None,
            element: new("n4")
        }
        .apply(&document()),
        Err(OpError::PageNotFound { id: "nada".into() })
    );
}

#[test]
fn delete_removes_and_undo_puts_it_back_in_its_place() {
    let document = apply_and_check_undo(&Op::Delete { id: "t1".into() });
    assert_eq!(ids(&document, 0), ["r1", "l1", "i1", "c1"]);
}

#[test]
fn reorder_moves_in_the_stack_and_undo_moves_back() {
    let document = apply_and_check_undo(&Op::Reorder {
        id: "r1".into(),
        index: 3,
    });
    assert_eq!(ids(&document, 0), ["l1", "t1", "i1", "r1", "c1"]);

    // Más allá del final: encima de todos.
    let document = apply_and_check_undo(&Op::Reorder {
        id: "r1".into(),
        index: 99,
    });
    assert_eq!(ids(&document, 0).last(), Some(&"r1"));
}

#[test]
fn restore_replaces_the_element_by_its_id() {
    let mut element = element(&document(), "r1").clone();
    if let Some(base) = element.base_mut() {
        base.w = 99.0;
    }
    let document = apply_and_check_undo(&Op::Restore { element });
    assert_eq!(
        super::tests::element(&document, "r1")
            .base()
            .expect("caja")
            .w,
        99.0
    );
}

/// El criterio de la tarea: un comando sobre un id que no existe devuelve
/// error, sea el comando que sea, y no toca nada.
#[test]
fn every_command_on_a_missing_id_is_an_error() {
    let ghost: Element = serde_json::from_value(json!({
        "id": "nadie", "type": "rect", "x": 0, "y": 0, "w": 1, "h": 1, "fill": null, "stroke": null
    }))
    .expect("es un elemento");
    let ops = [
        Op::Move {
            id: "nadie".into(),
            dx: 1.0,
            dy: 1.0,
        },
        Op::Resize {
            id: "nadie".into(),
            x: 0.0,
            y: 0.0,
            w: 1.0,
            h: None,
        },
        Op::Rotate {
            id: "nadie".into(),
            rotation: 1.0,
        },
        Op::SetProperty {
            id: "nadie".into(),
            property: Property::Radius(1.0),
        },
        Op::InsertText {
            id: "nadie".into(),
            at: 0,
            text: "x".into(),
        },
        Op::DeleteText {
            id: "nadie".into(),
            from: 0,
            to: 1,
        },
        Op::FormatText {
            id: "nadie".into(),
            from: 0,
            to: 1,
            format: Format {
                bold: Some(true),
                ..Format::default()
            },
        },
        Op::Delete { id: "nadie".into() },
        Op::Reorder {
            id: "nadie".into(),
            index: 0,
        },
        Op::Restore { element: ghost },
    ];
    for op in ops {
        assert_eq!(
            op.apply(&document()),
            Err(OpError::ElementNotFound { id: "nadie".into() }),
            "{op:?}"
        );
    }
}

/// El criterio de salida de la Fase 2: mover 100 veces y deshacer 100
/// veces deja el documento igual que al inicio, bit a bit.
#[test]
fn a_hundred_moves_and_a_hundred_undos_leave_the_document_as_it_was() {
    let original = document();
    let mut current = original.clone();
    let mut undos = Vec::new();
    for step in 0..100 {
        let op = Op::Move {
            id: "r1".into(),
            dx: 0.1 * f64::from(step),
            dy: -0.3,
        };
        let applied = op.apply(&current).expect("se aplica");
        undos.push(applied.undo);
        current = applied.document;
    }
    assert_ne!(current, original);
    for undo in undos.into_iter().rev() {
        current = undo.apply(&current).expect("se deshace").document;
    }
    assert_eq!(current, original);
    assert_eq!(
        current.to_json_string().expect("serializa"),
        original.to_json_string().expect("serializa")
    );
}

#[test]
fn every_command_describes_itself() {
    let element = element(&document(), "r1").clone();
    let cases = [
        (
            Op::Move {
                id: "r1".into(),
                dx: 1.0,
                dy: 1.0,
            },
            "Mover r1",
        ),
        (
            Op::Resize {
                id: "r1".into(),
                x: 0.0,
                y: 0.0,
                w: 1.0,
                h: None,
            },
            "Redimensionar r1",
        ),
        (
            Op::Rotate {
                id: "r1".into(),
                rotation: 1.0,
            },
            "Girar r1",
        ),
        (
            Op::SetProperty {
                id: "r1".into(),
                property: Property::Fill(None),
            },
            "Cambiar el relleno de r1",
        ),
        (
            Op::Create {
                page: "p1".into(),
                index: None,
                element: element.clone(),
            },
            "Crear r1",
        ),
        (Op::Delete { id: "r1".into() }, "Eliminar r1"),
        (
            Op::Reorder {
                id: "r1".into(),
                index: 0,
            },
            "Reordenar r1",
        ),
        (Op::Restore { element }, "Restaurar r1"),
    ];
    for (op, name) in cases {
        assert_eq!(op.describe(), name);
        assert_eq!(op.element_id(), Some("r1"));
    }
}

/// El criterio de la tarea: los comandos son serializables, con una forma
/// estable que la interfaz puede escribir.
#[test]
fn commands_serialize_and_deserialize() {
    let cases = [
        (
            Op::Move {
                id: "r1".into(),
                dx: 1.5,
                dy: -2.0,
            },
            json!({ "op": "move", "id": "r1", "dx": 1.5, "dy": -2.0 }),
        ),
        (
            Op::SetProperty {
                id: "r1".into(),
                property: Property::Fill(Some("#ff0000".into())),
            },
            json!({ "op": "set_property", "id": "r1", "property": { "name": "fill", "value": "#ff0000" } }),
        ),
        (
            Op::Resize {
                id: "t1".into(),
                x: 1.0,
                y: 2.0,
                w: 3.0,
                h: None,
            },
            json!({ "op": "resize", "id": "t1", "x": 1.0, "y": 2.0, "w": 3.0, "h": null }),
        ),
        (
            Op::Reorder {
                id: "r1".into(),
                index: 2,
            },
            json!({ "op": "reorder", "id": "r1", "index": 2 }),
        ),
        (
            Op::InsertText {
                id: "t1".into(),
                at: 4,
                text: "!".into(),
            },
            json!({ "op": "insert_text", "id": "t1", "at": 4, "text": "!" }),
        ),
        (
            Op::DeleteText {
                id: "t1".into(),
                from: 0,
                to: 2,
            },
            json!({ "op": "delete_text", "id": "t1", "from": 0, "to": 2 }),
        ),
        (
            Op::FormatText {
                id: "t1".into(),
                from: 0,
                to: 4,
                format: Format {
                    bold: Some(true),
                    ..Format::default()
                },
            },
            json!({ "op": "format_text", "id": "t1", "from": 0, "to": 4, "format": { "bold": true } }),
        ),
    ];
    for (op, expected) in cases {
        let value = serde_json::to_value(&op).expect("serializa");
        assert_eq!(value, expected);
        let back: Op = serde_json::from_value(value).expect("deserializa");
        assert_eq!(back, op);
    }

    // También el `undo` que devuelve un comando.
    let applied = Op::Delete { id: "t1".into() }
        .apply(&document())
        .expect("se aplica");
    let text = serde_json::to_string(&applied.undo).expect("serializa");
    let back: Op = serde_json::from_str(&text).expect("deserializa");
    assert_eq!(back, applied.undo);
}

/// Nombre, oculto y bloqueado valen para cualquier tipo, incluida la línea,
/// se deshacen y, al quitarse, no dejan rastro en el JSON.
#[test]
fn layer_properties_apply_to_every_element_and_leave_no_trace() {
    let original = document();
    for id in ["r1", "l1", "t1", "i1", "c1"] {
        for property in [
            Property::Name(Some("Mi capa".into())),
            Property::Hidden(true),
            Property::Locked(true),
        ] {
            let op = Op::SetProperty {
                id: id.into(),
                property: property.clone(),
            };
            let changed = apply_and_check_undo(&op);
            let layer = changed.element(id).expect("existe").layer().clone();
            match property {
                Property::Name(_) => assert_eq!(layer.name.as_deref(), Some("Mi capa")),
                Property::Hidden(_) => assert!(layer.is_hidden()),
                Property::Locked(_) => assert!(layer.is_locked()),
                _ => unreachable!(),
            }
        }

        // Ocultar y volver a mostrar deja el JSON como estaba.
        let hidden = Op::SetProperty {
            id: id.into(),
            property: Property::Hidden(true),
        }
        .apply(&original)
        .expect("se aplica")
        .document;
        let shown = Op::SetProperty {
            id: id.into(),
            property: Property::Hidden(false),
        }
        .apply(&hidden)
        .expect("se aplica")
        .document;
        assert_eq!(
            shown.to_json_string().expect("serializa"),
            original.to_json_string().expect("serializa")
        );
    }
}

#[test]
fn an_empty_name_goes_back_to_the_deduced_one() {
    let named = Op::SetProperty {
        id: "r1".into(),
        property: Property::Name(Some("Algo".into())),
    }
    .apply(&document())
    .expect("se aplica")
    .document;
    for empty in [None, Some(String::new()), Some("   ".into())] {
        let renamed = Op::SetProperty {
            id: "r1".into(),
            property: Property::Name(empty),
        }
        .apply(&named)
        .expect("se aplica")
        .document;
        assert_eq!(renamed.element("r1").expect("existe").layer().name, None);
    }
}

#[test]
fn layer_commands_describe_themselves() {
    let describe = |property| {
        Op::SetProperty {
            id: "r1".into(),
            property,
        }
        .describe()
    };
    assert_eq!(describe(Property::Name(Some("x".into()))), "Renombrar r1");
    assert_eq!(describe(Property::Hidden(true)), "Ocultar r1");
    assert_eq!(describe(Property::Hidden(false)), "Mostrar r1");
    assert_eq!(describe(Property::Locked(true)), "Bloquear r1");
    assert_eq!(describe(Property::Locked(false)), "Desbloquear r1");
}

#[test]
fn layer_properties_travel_as_the_ui_sends_them() {
    let op: Op = serde_json::from_value(json!({
        "op": "set_property", "id": "r1", "property": { "name": "hidden", "value": true }
    }))
    .expect("la interfaz lo manda así");
    assert_eq!(
        op,
        Op::SetProperty {
            id: "r1".into(),
            property: Property::Hidden(true)
        }
    );
}

#[test]
fn an_asset_can_be_added_and_the_key_must_be_new_and_valid() {
    let added = apply_and_check_undo(&Op::AddAsset {
        key: "nuevo".into(),
        path: "assets/nuevo.png".into(),
    });
    assert_eq!(added.assets["nuevo"], "assets/nuevo.png");

    let taken = Op::AddAsset {
        key: "logo".into(),
        path: "assets/x.png".into(),
    };
    assert_eq!(
        taken.apply(&document()),
        Err(OpError::AssetKeyTaken { key: "logo".into() })
    );
    let invalid = Op::AddAsset {
        key: "con espacio".into(),
        path: "assets/x.png".into(),
    };
    assert!(matches!(
        invalid.apply(&document()),
        Err(OpError::InvalidAssetKey { .. })
    ));
}

#[test]
fn an_unused_asset_is_removed_and_one_in_use_says_who_uses_it() {
    let removed = apply_and_check_undo(&Op::RemoveAsset { key: "otro".into() });
    assert!(!removed.assets.contains_key("otro"));

    let error = Op::RemoveAsset { key: "logo".into() }
        .apply(&document())
        .expect_err("i1 lo usa");
    assert_eq!(
        error,
        OpError::AssetInUse {
            key: "logo".into(),
            users: vec!["i1".into()]
        }
    );
    assert_eq!(
        error.to_string(),
        "el recurso \"logo\" lo usa i1; quítalos o cambia su imagen antes"
    );
    assert!(matches!(
        Op::RemoveAsset {
            key: "nadie".into()
        }
        .apply(&document()),
        Err(OpError::AssetNotFound { .. })
    ));
}

#[test]
fn renaming_an_asset_updates_every_image_that_uses_it() {
    let renamed = apply_and_check_undo(&Op::RenameAsset {
        from: "logo".into(),
        to: "marca".into(),
    });
    assert!(!renamed.assets.contains_key("logo"));
    assert_eq!(renamed.assets["marca"], "assets/logo.png");
    assert!(matches!(
        renamed.element("i1"),
        Some(Element::Image { asset, .. }) if asset == "marca"
    ));
    assert!(
        renamed.validate().is_ok(),
        "el documento sigue siendo válido"
    );

    let original = document();
    for (to, expected) in [
        ("otro", OpError::AssetKeyTaken { key: "otro".into() }),
        (
            "mal nombre",
            OpError::InvalidAssetKey {
                key: "mal nombre".into(),
            },
        ),
    ] {
        assert_eq!(
            Op::RenameAsset {
                from: "logo".into(),
                to: to.into()
            }
            .apply(&original),
            Err(expected)
        );
    }
    let describe = Op::RenameAsset {
        from: "logo".into(),
        to: "marca".into(),
    }
    .describe();
    assert_eq!(describe, "Renombrar el recurso logo a marca");
}

#[test]
fn a_font_is_declared_and_removed_back_in_its_place() {
    let mut original = document();
    original.fonts = vec![
        "fonts/a.ttf".into(),
        "fonts/b.ttf".into(),
        "fonts/c.ttf".into(),
    ];

    let removed = Op::RemoveFont {
        path: "fonts/b.ttf".into(),
    }
    .apply(&original)
    .expect("se aplica");
    assert_eq!(removed.document.fonts, ["fonts/a.ttf", "fonts/c.ttf"]);
    assert_eq!(
        removed.undo,
        Op::AddFont {
            path: "fonts/b.ttf".into(),
            index: Some(1)
        }
    );
    let back = removed.undo.apply(&removed.document).expect("se deshace");
    assert_eq!(back.document, original);

    let added = Op::AddFont {
        path: "fonts/d.ttf".into(),
        index: None,
    }
    .apply(&original)
    .expect("se aplica");
    assert_eq!(
        added.document.fonts.last().map(String::as_str),
        Some("fonts/d.ttf")
    );
    assert_eq!(
        added
            .undo
            .apply(&added.document)
            .expect("se deshace")
            .document,
        original
    );

    assert_eq!(
        Op::AddFont {
            path: "fonts/a.ttf".into(),
            index: None
        }
        .apply(&original),
        Err(OpError::FontAlreadyDeclared {
            path: "fonts/a.ttf".into()
        })
    );
    assert_eq!(
        Op::RemoveFont {
            path: "fonts/z.ttf".into()
        }
        .apply(&original),
        Err(OpError::FontNotDeclared {
            path: "fonts/z.ttf".into()
        })
    );
    assert_eq!(
        Op::RemoveFont {
            path: "fonts/b.ttf".into()
        }
        .describe(),
        "Quitar la fuente b.ttf"
    );
}

#[test]
fn the_title_changes_and_comes_back() {
    let changed = apply_and_check_undo(&Op::SetTitle {
        title: "  Informe anual 2026  ".into(),
    });
    assert_eq!(
        changed.meta.title, "Informe anual 2026",
        "sin espacios de más"
    );
    assert_eq!(
        Op::SetTitle { title: "x".into() }.describe(),
        "Cambiar el título"
    );

    for empty in ["", "   "] {
        assert_eq!(
            Op::SetTitle {
                title: empty.into()
            }
            .apply(&document()),
            Err(OpError::EmptyTitle)
        );
    }
}

#[test]
fn variables_are_set_renamed_and_removed() {
    let mut original = document();
    original
        .variables
        .insert("nombre".into(), "Cooperativa".into());

    // Crear una nueva: deshacerla la quita.
    let created = Op::SetVariable {
        name: "anio".into(),
        variable: "2026".into(),
    }
    .apply(&original)
    .expect("se aplica");
    assert_eq!(created.document.variables["anio"].value, "2026");
    assert_eq!(
        created.undo,
        Op::RemoveVariable {
            name: "anio".into()
        }
    );
    assert_eq!(
        created
            .undo
            .apply(&created.document)
            .expect("se deshace")
            .document,
        original
    );

    // Cambiar una que ya está: deshacerla devuelve el valor de antes.
    let changed = Op::SetVariable {
        name: "nombre".into(),
        variable: "Otra".into(),
    }
    .apply(&original)
    .expect("se aplica");
    assert_eq!(
        changed.undo,
        Op::SetVariable {
            name: "nombre".into(),
            variable: "Cooperativa".into()
        }
    );

    let renamed = Op::RenameVariable {
        from: "nombre".into(),
        to: "empresa".into(),
    }
    .apply(&original)
    .expect("se aplica");
    assert_eq!(renamed.document.variables["empresa"].value, "Cooperativa");
    assert!(!renamed.document.variables.contains_key("nombre"));
    assert_eq!(
        renamed
            .undo
            .apply(&renamed.document)
            .expect("se deshace")
            .document,
        original
    );

    let removed = Op::RemoveVariable {
        name: "nombre".into(),
    }
    .apply(&original)
    .expect("se aplica");
    assert!(removed.document.variables.is_empty());
    assert_eq!(
        removed
            .undo
            .apply(&removed.document)
            .expect("se deshace")
            .document,
        original
    );
}

#[test]
fn a_variable_name_has_to_be_new_and_valid() {
    let mut original = document();
    original.variables.insert("nombre".into(), "x".into());
    original.variables.insert("anio".into(), "2026".into());

    assert_eq!(
        Op::SetVariable {
            name: "con espacio".into(),
            variable: "x".into()
        }
        .apply(&original),
        Err(OpError::InvalidVariableName {
            name: "con espacio".into()
        })
    );
    assert_eq!(
        Op::RenameVariable {
            from: "nombre".into(),
            to: "anio".into()
        }
        .apply(&original),
        Err(OpError::VariableNameTaken {
            name: "anio".into()
        })
    );
    assert_eq!(
        Op::RemoveVariable {
            name: "nadie".into()
        }
        .apply(&original),
        Err(OpError::VariableNotFound {
            name: "nadie".into()
        })
    );
    assert_eq!(
        Op::SetVariable {
            name: "nombre".into(),
            variable: "y".into()
        }
        .describe(),
        "Cambiar la variable nombre"
    );
}

#[test]
fn an_element_id_changes_and_comes_back() {
    let renamed = apply_and_check_undo(&Op::Rename {
        id: "r1".into(),
        to: "banda".into(),
    });
    assert!(renamed.element("banda").is_some());
    assert!(renamed.element("r1").is_none());
    assert!(
        renamed.validate().is_ok(),
        "el documento sigue siendo válido"
    );

    // También el de una línea, que guarda su id aparte.
    let line = apply_and_check_undo(&Op::Rename {
        id: "l1".into(),
        to: "separador".into(),
    });
    assert!(line.element("separador").is_some());

    assert_eq!(
        Op::Rename {
            id: "r1".into(),
            to: "banda".into()
        }
        .describe(),
        "Renombrar r1 a banda"
    );
}

#[test]
fn an_id_has_to_be_free_and_valid() {
    let original = document();
    assert_eq!(
        Op::Rename {
            id: "r1".into(),
            to: "t1".into()
        }
        .apply(&original),
        Err(OpError::DuplicateId { id: "t1".into() })
    );
    assert_eq!(
        Op::Rename {
            id: "r1".into(),
            to: "p1".into()
        }
        .apply(&original),
        Err(OpError::DuplicateId { id: "p1".into() }),
        "tampoco el de una página"
    );
    assert_eq!(
        Op::Rename {
            id: "r1".into(),
            to: "con espacio".into()
        }
        .apply(&original),
        Err(OpError::InvalidId {
            id: "con espacio".into()
        })
    );
    assert!(matches!(
        Op::Rename {
            id: "nadie".into(),
            to: "x".into()
        }
        .apply(&original),
        Err(OpError::ElementNotFound { .. })
    ));

    // Cambiarlo por el mismo no es un error, y no cambia nada.
    let same = Op::Rename {
        id: "r1".into(),
        to: "r1".into(),
    }
    .apply(&original)
    .expect("se aplica");
    assert_eq!(same.document, original);
}

/// El criterio de la tarea: escribir, borrar y dar formato son comandos, y
/// deshacer devuelve el texto exactamente como estaba.
#[test]
fn writing_deleting_and_formatting_are_commands() {
    let written = apply_and_check_undo(&Op::InsertText {
        id: "t1".into(),
        at: 4,
        text: ", mundo".into(),
    });
    assert_eq!(content(&written, "t1"), vec![("Hola, mundo", false)]);

    let deleted = apply_and_check_undo(&Op::DeleteText {
        id: "t1".into(),
        from: 0,
        to: 2,
    });
    assert_eq!(content(&deleted, "t1"), vec![("la", false)]);

    let formatted = apply_and_check_undo(&Op::FormatText {
        id: "t1".into(),
        from: 0,
        to: 2,
        format: Format {
            bold: Some(true),
            ..Format::default()
        },
    });
    assert_eq!(content(&formatted, "t1"), vec![("Ho", true), ("la", false)]);
}

/// Las posiciones se cuentan en caracteres, no en bytes: un emoji es uno.
#[test]
fn text_positions_are_counted_in_characters() {
    let original = document();
    let with_emoji = Op::InsertText {
        id: "t1".into(),
        at: 4,
        text: " 👩‍🌾".into(),
    }
    .apply(&original)
    .expect("se aplica")
    .document;
    assert_eq!(text_of(&with_emoji, "t1"), "Hola 👩‍🌾");

    // El emoji está en la posición 5 y ocupa una: borrarlo lo quita entero.
    let without = Op::DeleteText {
        id: "t1".into(),
        from: 5,
        to: 6,
    }
    .apply(&with_emoji)
    .expect("se aplica")
    .document;
    assert_eq!(text_of(&without, "t1"), "Hola ");
}

/// Los comandos de texto solo valen en un bloque de texto, y solo dentro
/// del texto que hay.
#[test]
fn text_commands_only_work_on_text_and_inside_it() {
    assert_eq!(
        Op::InsertText {
            id: "r1".into(),
            at: 0,
            text: "x".into(),
        }
        .apply(&document()),
        Err(OpError::NotApplicable {
            id: "r1".into(),
            kind: "rect",
            what: "Escribir".into(),
        })
    );

    assert_eq!(
        Op::DeleteText {
            id: "t1".into(),
            from: 0,
            to: 9,
        }
        .apply(&document()),
        Err(OpError::Text(TextError::OutOfRange { at: 9, length: 4 }))
    );

    assert_eq!(
        Op::FormatText {
            id: "t1".into(),
            from: 3,
            to: 1,
            format: Format {
                italic: Some(true),
                ..Format::default()
            },
        }
        .apply(&document()),
        Err(OpError::Text(TextError::Backwards { from: 3, to: 1 }))
    );
}

/// El criterio de la tarea: hacer lista, quitarla y cambiar de nivel son
/// comandos, y deshacer devuelve las líneas como estaban.
#[test]
fn making_a_list_is_a_command() {
    let listed = apply_and_check_undo(&Op::SetLines {
        id: "t1".into(),
        from: 0,
        to: 4,
        line: Line {
            list: Some(ListKind::Bullet),
            level: 0,
        },
    });
    assert_eq!(
        lines(&listed, "t1"),
        vec![Line {
            list: Some(ListKind::Bullet),
            level: 0
        }]
    );

    // Y quitarla no deja rastro en el JSON.
    let plain = Op::SetLines {
        id: "t1".into(),
        from: 0,
        to: 4,
        line: Line::default(),
    }
    .apply(&listed)
    .expect("se aplica")
    .document;
    assert!(lines(&plain, "t1").is_empty());
}

/// Los estilos van por número de línea: al escribir o borrar saltos, se
/// mueven con el texto.
#[test]
fn the_line_styles_follow_the_text() {
    let document = document();
    let listed = Op::SetLines {
        id: "t1".into(),
        from: 0,
        to: 4,
        line: Line {
            list: Some(ListKind::Numbered),
            level: 0,
        },
    }
    .apply(&document)
    .expect("se aplica")
    .document;

    // Partir la línea da otro elemento de la misma lista, como al pulsar
    // Enter dentro de una.
    let split = Op::InsertText {
        id: "t1".into(),
        at: 2,
        text: "\n".into(),
    }
    .apply(&listed)
    .expect("se aplica")
    .document;
    assert_eq!(
        lines(&split, "t1"),
        vec![
            Line {
                list: Some(ListKind::Numbered),
                level: 0
            };
            2
        ]
    );

    // Y al juntarlas otra vez, queda el estilo de la primera.
    let joined = Op::DeleteText {
        id: "t1".into(),
        from: 2,
        to: 3,
    }
    .apply(&split)
    .expect("se aplica")
    .document;
    assert_eq!(lines(&joined, "t1").len(), 1);
}

/// Las líneas de un bloque de texto, para leerlas de un vistazo.
fn lines<'a>(document: &'a Document, id: &str) -> &'a [Line] {
    match element(document, id) {
        Element::Text { lines, .. } => lines,
        other => panic!("{} no es un texto", other.id()),
    }
}

/// El texto y el formato de un bloque, para leerlos de un vistazo.
fn content<'a>(document: &'a Document, id: &str) -> Vec<(&'a str, bool)> {
    match element(document, id) {
        Element::Text { content, .. } => content
            .iter()
            .map(|run| (run.text.as_str(), run.bold))
            .collect(),
        other => panic!("{} no es un texto", other.id()),
    }
}

fn text_of(document: &Document, id: &str) -> String {
    content(document, id)
        .into_iter()
        .map(|(text, _)| text)
        .collect()
}

/// Varios comandos como uno: un único paso del historial.
#[test]
fn a_batch_applies_every_command_in_order() {
    let document = apply_and_check_undo(&Op::Batch {
        ops: vec![
            Op::Move {
                id: "r1".into(),
                dx: 5.0,
                dy: 0.0,
            },
            Op::Move {
                id: "t1".into(),
                dx: 5.0,
                dy: 0.0,
            },
        ],
    });
    assert_eq!(element(&document, "r1").base().expect("caja").x, 15.0);
    assert_eq!(element(&document, "t1").base().expect("caja").x, 25.0);
}

/// Lo que importa de un compuesto: o entra todo, o no entra nada.
#[test]
fn a_batch_that_fails_halfway_changes_nothing() {
    let original = document();
    let error = Op::Batch {
        ops: vec![
            Op::Move {
                id: "r1".into(),
                dx: 5.0,
                dy: 0.0,
            },
            Op::Move {
                id: "fantasma".into(),
                dx: 5.0,
                dy: 0.0,
            },
        ],
    }
    .apply(&original)
    .expect_err("el segundo no existe");

    assert!(matches!(error, OpError::ElementNotFound { .. }));
    assert_eq!(document(), original, "el primero tampoco se ha aplicado");
}

/// Se deshacen del último al primero: lo contrario de como entraron.
#[test]
fn a_batch_undoes_backwards() {
    let original = document();
    let applied = Op::Batch {
        ops: vec![
            Op::Rename {
                id: "r1".into(),
                to: "primero".into(),
            },
            Op::Rename {
                id: "primero".into(),
                to: "segundo".into(),
            },
        ],
    }
    .apply(&original)
    .expect("se aplica");
    assert!(applied.document.element("segundo").is_some());

    let back = applied.undo.apply(&applied.document).expect("se deshace");
    assert_eq!(back.document, original);
}

#[test]
fn a_batch_is_named_by_what_it_does() {
    let moves = |count: usize| Op::Batch {
        ops: (0..count)
            .map(|index| Op::Move {
                id: format!("r{index}"),
                dx: 1.0,
                dy: 0.0,
            })
            .collect(),
    };
    assert_eq!(moves(3).describe(), "Mover 3 elementos");
    // Con uno solo, lo que diga ese.
    assert_eq!(moves(1).describe(), "Mover r0");
    assert_eq!(Op::Batch { ops: vec![] }.describe(), "No hacer nada");

    let mixed = Op::Batch {
        ops: vec![
            Op::Move {
                id: "r1".into(),
                dx: 1.0,
                dy: 0.0,
            },
            Op::Rename {
                id: "t1".into(),
                to: "otro".into(),
            },
        ],
    };
    assert_eq!(mixed.describe(), "Cambiar 2 elementos");

    // Borrar varios (cortar, o Supr en la interfaz) dice lo que hizo.
    let deletes = Op::Batch {
        ops: ["r1", "t1", "e1"]
            .into_iter()
            .map(|id| Op::Delete { id: id.into() })
            .collect(),
    };
    assert_eq!(deletes.describe(), "Eliminar 3 elementos");
}

/// El elemento de un compuesto solo existe si todos son el mismo.
#[test]
fn a_batch_of_several_elements_is_of_none_of_them() {
    let same = Op::Batch {
        ops: vec![
            Op::Move {
                id: "r1".into(),
                dx: 1.0,
                dy: 0.0,
            },
            Op::Rotate {
                id: "r1".into(),
                rotation: 10.0,
            },
        ],
    };
    assert_eq!(same.element_id(), Some("r1"));

    let several = Op::Batch {
        ops: vec![
            Op::Move {
                id: "r1".into(),
                dx: 1.0,
                dy: 0.0,
            },
            Op::Move {
                id: "t1".into(),
                dx: 1.0,
                dy: 0.0,
            },
        ],
    };
    assert_eq!(several.element_id(), None);
}

/// El criterio de la tarea: agrupar no mueve nada de sitio.
#[test]
fn grouping_moves_nothing_and_counts_from_the_group() {
    let document = apply_and_check_undo(&Op::Group {
        ids: vec!["r1".into(), "t1".into()],
        id: "g1".into(),
        // r1 está en (10,20) 30×40 y t1 en (20,100) 80 de ancho.
        rect: crate::layout::MmRect {
            x: 10.0,
            y: 20.0,
            w: 90.0,
            h: 120.0,
        },
    });

    let Element::Group { base, children } = element(&document, "g1") else {
        panic!("es un grupo");
    };
    assert_eq!(
        (base.x, base.y, base.w, base.h),
        (10.0, 20.0, 90.0, Some(120.0))
    );
    assert_eq!(
        children.iter().map(Element::id).collect::<Vec<_>>(),
        vec!["r1", "t1"]
    );
    // Las posiciones son relativas: r1 estaba en (10,20), que es la esquina.
    assert_eq!(children[0].position(), (0.0, 0.0));
    assert_eq!(children[1].position(), (10.0, 80.0));
    // El grupo ocupa la capa del que estaba más arriba de los dos.
    assert_eq!(ids(&document, 0), vec!["l1", "g1", "i1", "c1"]);
}

/// Y desagrupar los devuelve exactamente a donde estaban.
#[test]
fn ungrouping_puts_everything_back_where_it_was() {
    let before = document();
    // Dos que están seguidos en la pila: así desagrupar deja la página
    // exactamente como estaba, capas incluidas.
    let grouped = Op::Group {
        ids: vec!["r1".into(), "l1".into()],
        id: "g1".into(),
        rect: crate::layout::MmRect {
            x: 5.0,
            y: 6.0,
            w: 45.0,
            h: 54.0,
        },
    }
    .apply(&before)
    .expect("se agrupa");

    let ungrouped = Op::Ungroup { id: "g1".into() }
        .apply(&grouped.document)
        .expect("se desagrupa");
    assert_eq!(ungrouped.document, before);

    // Y deshacer el desagrupado vuelve a dejar el grupo.
    let back = ungrouped
        .undo
        .apply(&ungrouped.document)
        .expect("se deshace");
    assert_eq!(back.document, grouped.document);
}

#[test]
fn a_group_can_hold_another_group() {
    let rect = crate::layout::MmRect {
        x: 0.0,
        y: 0.0,
        w: 100.0,
        h: 100.0,
    };
    let inner = Op::Group {
        ids: vec!["r1".into(), "t1".into()],
        id: "g1".into(),
        rect,
    }
    .apply(&document())
    .expect("se agrupa");
    let outer = Op::Group {
        ids: vec!["g1".into(), "i1".into()],
        id: "g2".into(),
        rect,
    }
    .apply(&inner.document)
    .expect("se agrupa otra vez");

    let Element::Group { children, .. } = outer.document.element("g2").expect("está") else {
        panic!("es un grupo");
    };
    assert_eq!(children.len(), 2);
    assert_eq!(children[0].id(), "g1");
    assert_eq!(children[0].children().len(), 2, "el de dentro sigue entero");
    // Un hijo de un grupo se encuentra por su id, esté donde esté.
    assert!(outer.document.element("r1").is_some());
}

#[test]
fn what_cannot_be_grouped_says_why() {
    let one = Op::Group {
        ids: vec!["r1".into()],
        id: "g1".into(),
        rect: crate::layout::MmRect {
            x: 0.0,
            y: 0.0,
            w: 1.0,
            h: 1.0,
        },
    }
    .apply(&document())
    .expect_err("hace falta más de uno");
    assert!(matches!(one, OpError::NotApplicable { .. }));

    let taken = Op::Group {
        ids: vec!["r1".into(), "t1".into()],
        id: "l1".into(),
        rect: crate::layout::MmRect {
            x: 0.0,
            y: 0.0,
            w: 1.0,
            h: 1.0,
        },
    }
    .apply(&document())
    .expect_err("ese id ya es de otro");
    assert!(matches!(taken, OpError::DuplicateId { .. }));

    let ghost = Op::Group {
        ids: vec!["r1".into(), "fantasma".into()],
        id: "g1".into(),
        rect: crate::layout::MmRect {
            x: 0.0,
            y: 0.0,
            w: 1.0,
            h: 1.0,
        },
    }
    .apply(&document())
    .expect_err("no existe");
    assert!(matches!(ghost, OpError::ElementNotFound { .. }));

    let not_a_group = Op::Ungroup { id: "r1".into() }
        .apply(&document())
        .expect_err("no es un grupo");
    assert!(matches!(not_a_group, OpError::NotApplicable { .. }));
}

/// El criterio de la tarea: se puede editar un hijo sin sacarlo del grupo.
#[test]
fn a_child_of_a_group_is_edited_like_any_other_element() {
    let grouped = Op::Group {
        ids: vec!["r1".into(), "t1".into()],
        id: "g1".into(),
        rect: crate::layout::MmRect {
            x: 10.0,
            y: 20.0,
            w: 90.0,
            h: 120.0,
        },
    }
    .apply(&document())
    .expect("se agrupa");

    let moved = Op::Move {
        id: "r1".into(),
        dx: 5.0,
        dy: 0.0,
    }
    .apply(&grouped.document)
    .expect("se mueve dentro del grupo");
    assert_eq!(
        moved.document.element("r1").expect("está").position(),
        (5.0, 0.0)
    );

    // Y se deshace como cualquier otro cambio.
    let back = moved.undo.apply(&moved.document).expect("se deshace");
    assert_eq!(back.document, grouped.document);
}

/// Agrupar un elemento girado conserva su giro, y desagrupar un grupo
/// girado se lo pasa a los hijos.
#[test]
fn ungrouping_a_turned_group_turns_its_children() {
    let rect = crate::layout::MmRect {
        x: 0.0,
        y: 0.0,
        w: 100.0,
        h: 100.0,
    };
    let grouped = Op::Group {
        ids: vec!["r1".into(), "t1".into()],
        id: "g1".into(),
        rect,
    }
    .apply(&document())
    .expect("se agrupa");
    let turned = Op::Rotate {
        id: "g1".into(),
        rotation: 90.0,
    }
    .apply(&grouped.document)
    .expect("se gira");

    let freed = Op::Ungroup { id: "g1".into() }
        .apply(&turned.document)
        .expect("se desagrupa");
    let child = freed.document.element("r1").expect("está");
    assert_eq!(child.rotation(), 90.0, "el hijo se queda con el giro");
    // El centro de r1 estaba en (25,40) y el del grupo en (50,50): girando
    // 90° en sentido horario, va a (60,25); su caja es 30×40.
    assert_eq!(child.position(), (45.0, 5.0));
}

/// Una página vacía, como la que se añade desde la interfaz.
fn blank(id: &str) -> crate::model::Page {
    crate::model::Page {
        id: id.to_owned(),
        size: crate::model::PageSize {
            width: 210.0,
            height: 297.0,
            unit: crate::model::Unit::Mm,
        },
        elements: Vec::new(),
    }
}

/// El criterio de la tarea: añadir, y deshacerlo.
#[test]
fn a_page_is_added_where_it_is_asked_for() {
    let document = apply_and_check_undo(&Op::InsertPage {
        index: Some(1),
        page: blank("p3"),
    });
    assert_eq!(
        document
            .pages
            .iter()
            .map(|page| page.id.as_str())
            .collect::<Vec<_>>(),
        vec!["p1", "p3", "p2"]
    );

    // Sin posición, al final.
    let last = apply_and_check_undo(&Op::InsertPage {
        index: None,
        page: blank("p3"),
    });
    assert_eq!(last.pages.last().map(|page| page.id.as_str()), Some("p3"));
}

/// El criterio de la tarea: quitar una página se deshace con todo dentro.
#[test]
fn removing_a_page_takes_its_elements_and_undo_brings_them_back() {
    let document = apply_and_check_undo(&Op::RemovePage { id: "p1".into() });
    assert_eq!(document.pages.len(), 1);
    assert_eq!(document.pages[0].id, "p2");
    assert!(document.element("r1").is_none(), "se fue con su página");
}

/// El criterio de la tarea: la última página no se quita.
#[test]
fn the_last_page_cannot_be_removed() {
    let one = Op::RemovePage { id: "p2".into() }
        .apply(&document())
        .expect("quedan dos")
        .document;
    let error = Op::RemovePage { id: "p1".into() }
        .apply(&one)
        .expect_err("es la última");
    assert!(matches!(error, OpError::NotApplicable { .. }));

    let ghost = Op::RemovePage {
        id: "fantasma".into(),
    }
    .apply(&document())
    .expect_err("no existe");
    assert!(matches!(ghost, OpError::PageNotFound { .. }));
}

/// El criterio de la tarea: duplicar da ids nuevos a todos los elementos.
#[test]
fn duplicating_a_page_gives_every_element_a_new_id() {
    let document = apply_and_check_undo(&Op::DuplicatePage {
        id: "p1".into(),
        to: "p3".into(),
    });

    // La copia va justo detrás de la original.
    assert_eq!(
        document
            .pages
            .iter()
            .map(|page| page.id.as_str())
            .collect::<Vec<_>>(),
        vec!["p1", "p3", "p2"]
    );
    let copy = &document.pages[1];
    assert_eq!(
        copy.elements.iter().map(Element::id).collect::<Vec<_>>(),
        vec!["r1-2", "l1-2", "t1-2", "i1-2", "c1-2"]
    );
    // Y los originales siguen donde estaban, con su id.
    assert_eq!(
        document.pages[0]
            .elements
            .iter()
            .map(Element::id)
            .collect::<Vec<_>>(),
        vec!["r1", "l1", "t1", "i1", "c1"]
    );
    // Lo copiado es lo mismo salvo el id: misma posición, mismo contenido.
    let original = element(&document, "r1").base().expect("caja").clone();
    let copied = element(&document, "r1-2").base().expect("caja").clone();
    assert_eq!(
        (copied.x, copied.y, copied.w),
        (original.x, original.y, original.w)
    );
}

/// Copiar dos veces no repite ids, y la segunda copia cuenta desde la raíz.
#[test]
fn duplicating_twice_keeps_looking_for_free_ids() {
    let once = Op::DuplicatePage {
        id: "p1".into(),
        to: "p3".into(),
    }
    .apply(&document())
    .expect("se copia");
    let twice = Op::DuplicatePage {
        id: "p3".into(),
        to: "p4".into(),
    }
    .apply(&once.document)
    .expect("se copia otra vez");

    let ids: Vec<&str> = twice.document.pages[2]
        .elements
        .iter()
        .map(Element::id)
        .collect();
    assert_eq!(ids, vec!["r1-3", "l1-3", "t1-3", "i1-3", "c1-3"]);
}

#[test]
fn duplicating_a_page_renames_what_is_inside_a_group_too() {
    let grouped = Op::Group {
        ids: vec!["r1".into(), "l1".into()],
        id: "g1".into(),
        rect: crate::layout::MmRect {
            x: 0.0,
            y: 0.0,
            w: 100.0,
            h: 100.0,
        },
    }
    .apply(&document())
    .expect("se agrupa");

    let copied = Op::DuplicatePage {
        id: "p1".into(),
        to: "p3".into(),
    }
    .apply(&grouped.document)
    .expect("se copia");

    assert!(copied.document.element("g1-2").is_some());
    assert!(copied.document.element("r1-2").is_some(), "el hijo también");
    assert_eq!(
        copied
            .document
            .element("g1-2")
            .expect("está")
            .children()
            .len(),
        2
    );
}

#[test]
fn a_page_with_an_id_that_is_taken_does_not_go_in() {
    let taken = Op::InsertPage {
        index: None,
        page: blank("p1"),
    }
    .apply(&document())
    .expect_err("ese id ya es de otra");
    assert!(matches!(taken, OpError::DuplicateId { .. }));

    let copy = Op::DuplicatePage {
        id: "p1".into(),
        to: "p2".into(),
    }
    .apply(&document())
    .expect_err("ese id ya es de otra");
    assert!(matches!(copy, OpError::DuplicateId { .. }));
}

/// Cambiar el tamaño de una página, y deshacerlo: vuelve el de antes, con su
/// unidad. Los elementos no se mueven.
#[test]
fn a_page_is_resized_and_undo_puts_the_size_back() {
    let letter = crate::model::PageSize {
        width: 8.5,
        height: 11.0,
        unit: crate::model::Unit::In,
    };
    let document = apply_and_check_undo(&Op::ResizePage {
        id: "p1".into(),
        size: letter.clone(),
    });
    assert_eq!(document.pages[0].size, letter);
    assert_eq!(
        document.pages[0].elements,
        self::document().pages[0].elements
    );
    assert_eq!(
        Op::ResizePage {
            id: "p1".into(),
            size: letter
        }
        .describe(),
        "Cambiar el tamaño de la página p1"
    );
}

/// Una medida que no es mayor que cero, o que no es un número, no vale; y
/// la página tiene que existir.
#[test]
fn a_page_size_has_to_make_sense() {
    for (width, height) in [
        (0.0, 297.0),
        (210.0, -1.0),
        (f64::NAN, 297.0),
        (f64::INFINITY, 297.0),
    ] {
        let error = Op::ResizePage {
            id: "p1".into(),
            size: crate::model::PageSize {
                width,
                height,
                unit: crate::model::Unit::Mm,
            },
        }
        .apply(&document())
        .expect_err("no vale");
        assert!(
            matches!(error, OpError::InvalidPageSize { .. }),
            "{width} × {height}"
        );
    }
    let missing = Op::ResizePage {
        id: "no".into(),
        size: blank("x").size,
    }
    .apply(&document())
    .expect_err("no existe");
    assert!(matches!(missing, OpError::PageNotFound { .. }));
}

/// El criterio de la tarea: reordenar, y deshacerlo.
#[test]
fn pages_are_reordered_and_undo_puts_them_back() {
    let document = apply_and_check_undo(&Op::ReorderPage {
        id: "p1".into(),
        index: 1,
    });
    assert_eq!(
        document
            .pages
            .iter()
            .map(|page| page.id.as_str())
            .collect::<Vec<_>>(),
        vec!["p2", "p1"]
    );
}
