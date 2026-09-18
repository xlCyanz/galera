use serde_json::json;

use super::*;
use crate::model::Stroke;

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
        assert_eq!(op.element_id(), "r1");
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
