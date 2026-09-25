import { beforeEach, describe, expect, it } from "vitest";

import { useLatencyStore } from "./latency";

const store = () => useLatencyStore.getState();

beforeEach(() => {
  useLatencyStore.setState(useLatencyStore.getInitialState(), true);
});

describe("lo que tarda una tecla en verse", () => {
  it("va de la tecla a la siguiente página pintada", () => {
    store().typed(100);
    store().painted(123.5);
    expect(store().last).toBe(23.5);
    expect(store().waitingSince).toBeNull();
  });

  /** Escribiendo deprisa, cuenta desde la primera tecla que no se ve: es
   * la que más ha esperado. */
  it("con varias teclas antes de pintar, cuenta desde la primera", () => {
    store().typed(100);
    store().typed(110);
    store().typed(120);
    store().painted(150);
    expect(store().last).toBe(50);
  });

  it("pintar sin haber tecleado —mover, hacer zoom— no mide nada", () => {
    store().painted(50);
    expect(store().last).toBeNull();
    store().typed(100);
    store().painted(130);
    store().painted(500);
    expect(store().last).toBe(30);
  });

  it("otro documento lo olvida", () => {
    store().typed(100);
    store().painted(130);
    store().reset();
    expect(store()).toMatchObject({ last: null, waitingSince: null });
  });
});
