import { beforeEach, describe, expect, it } from "vitest";

import type { OpenedProject } from "../commands";
import type { Page } from "../types/model";
import { MAX_ZOOM, MIN_ZOOM, clampPage, clampZoom, useDocumentStore } from "./document";

function page(id: string): Page {
  return { id, size: { width: 210, height: 297, unit: "mm" }, elements: [] };
}

function project(title: string, pageCount: number): OpenedProject {
  return {
    root: `/proyectos/${title}`,
    revision: 1,
    document: {
      version: 1,
      meta: { title },
      fonts: [],
      assets: {},
      variables: {},
      pages: Array.from({ length: pageCount }, (_, index) => page(`p${index + 1}`)),
    },
  };
}

const store = () => useDocumentStore.getState();

beforeEach(() => {
  useDocumentStore.setState(useDocumentStore.getInitialState(), true);
});

describe("store del documento", () => {
  it("empieza sin documento, en la primera página, al 100 % y sin desplazar", () => {
    expect(store()).toMatchObject({
      document: null,
      root: null,
      currentPage: 0,
      zoom: 1,
      scroll: { x: 0, y: 0 },
    });
  });

  it("abrir guarda documento y carpeta", () => {
    const informe = project("Informe", 3);
    store().open(informe);

    expect(store().document).toBe(informe.document);
    expect(store().root).toBe("/proyectos/Informe");
  });

  it("abrir otro vuelve a la primera página y quita el desplazamiento, pero conserva el zoom", () => {
    store().open(project("Informe", 3));
    store().setCurrentPage(2);
    store().setZoom(2);
    store().scrollBy(40, -10);

    store().open(project("Carta", 1));
    expect(store()).toMatchObject({ currentPage: 0, zoom: 2, scroll: { x: 0, y: 0 } });
  });

  it("cerrar olvida el documento", () => {
    store().open(project("Informe", 3));
    store().setCurrentPage(1);
    store().close();

    expect(store()).toMatchObject({ document: null, root: null, currentPage: 0 });
  });

  it("la página actual no se sale de las que hay", () => {
    store().open(project("Informe", 3));

    store().setCurrentPage(1);
    expect(store().currentPage).toBe(1);
    store().setCurrentPage(7);
    expect(store().currentPage).toBe(2);
    store().setCurrentPage(-1);
    expect(store().currentPage).toBe(0);
    store().setCurrentPage(1.8);
    expect(store().currentPage).toBe(1);
  });

  it("sin documento, la página es siempre la 0", () => {
    store().setCurrentPage(4);
    expect(store().currentPage).toBe(0);
  });

  it("el zoom se queda entre el 25 % y el 800 %", () => {
    store().setZoom(1.5);
    expect(store().zoom).toBe(1.5);
    store().setZoom(0.01);
    expect(store().zoom).toBe(MIN_ZOOM);
    store().setZoom(100);
    expect(store().zoom).toBe(MAX_ZOOM);
  });

  it("un zoom o un desplazamiento que no es un número no cambia nada", () => {
    store().setZoom(2);
    store().setZoom(Number.NaN);
    store().setZoom(Number.POSITIVE_INFINITY);
    expect(store().zoom).toBe(2);

    store().setScroll({ x: 5, y: 6 });
    store().setScroll({ x: Number.NaN, y: 1 });
    store().scrollBy(Number.NaN, 1);
    expect(store().scroll).toEqual({ x: 5, y: 6 });
  });

  it("desplazar suma a lo que había; colocar lo sustituye", () => {
    store().scrollBy(10, 20);
    store().scrollBy(-4, 5);
    expect(store().scroll).toEqual({ x: 6, y: 25 });

    store().setScroll({ x: 100, y: 0 });
    expect(store().scroll).toEqual({ x: 100, y: 0 });
  });
});

describe("setView", () => {
  it("cambia zoom y desplazamiento a la vez, con un solo aviso", () => {
    let notifications = 0;
    const unsubscribe = useDocumentStore.subscribe(() => notifications++);
    store().setView(3, { x: -40, y: 12 });
    unsubscribe();

    expect(store()).toMatchObject({ zoom: 3, scroll: { x: -40, y: 12 } });
    expect(notifications).toBe(1);
  });

  it("respeta los límites y descarta lo que no es un número", () => {
    store().setView(50, { x: 1, y: 2 });
    expect(store().zoom).toBe(MAX_ZOOM);
    store().setView(Number.NaN, { x: Number.NaN, y: 0 });
    expect(store()).toMatchObject({ zoom: MAX_ZOOM, scroll: { x: 1, y: 2 } });
  });
});

describe("reglas", () => {
  it("se ven al empezar, se ocultan y se vuelven a enseñar", () => {
    expect(store().rulersVisible).toBe(true);
    store().toggleRulers();
    expect(store().rulersVisible).toBe(false);
    store().toggleRulers();
    expect(store().rulersVisible).toBe(true);
  });

  it("abrir otro documento no las cambia", () => {
    store().toggleRulers();
    store().open(project("Carta", 1));
    expect(store().rulersVisible).toBe(false);
  });
});

describe("límites", () => {
  it("clampZoom", () => {
    expect(clampZoom(0.25)).toBe(0.25);
    expect(clampZoom(8)).toBe(8);
    expect(clampZoom(0)).toBe(0.25);
  });

  it("clampPage", () => {
    expect(clampPage(0, 0)).toBe(0);
    expect(clampPage(5, 0)).toBe(0);
    expect(clampPage(Number.NaN, 3)).toBe(0);
    expect(clampPage(2, 3)).toBe(2);
  });
});
