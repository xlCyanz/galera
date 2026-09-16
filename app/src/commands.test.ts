import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it } from "vitest";

import { ping } from "./commands";

afterEach(() => {
  clearMocks();
});

describe("ping", () => {
  it("llama al comando `ping` con el mensaje y devuelve su respuesta", async () => {
    const calls: Array<{ command: string; args: unknown }> = [];
    mockIPC((command, args) => {
      calls.push({ command, args });
      return `pong: ${(args as { message: string }).message}`;
    });

    await expect(ping("hola")).resolves.toBe("pong: hola");
    expect(calls).toEqual([{ command: "ping", args: { message: "hola" } }]);
  });

  it("propaga el error si el backend falla", async () => {
    mockIPC(() => {
      throw new Error("backend caído");
    });

    await expect(ping("hola")).rejects.toThrow("backend caído");
  });
});
