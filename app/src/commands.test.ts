import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it } from "vitest";

import { type SessionStatus, sessionStatus } from "./commands";

afterEach(() => {
  clearMocks();
});

const closed: SessionStatus = {
  coreVersion: "0.1.0",
  title: null,
  pageCount: 0,
  compiledIsCurrent: false,
};

describe("sessionStatus", () => {
  it("llama a `session_status` sin argumentos y devuelve su respuesta", async () => {
    const calls: Array<{ command: string; args: unknown }> = [];
    mockIPC((command, args) => {
      calls.push({ command, args });
      return closed;
    });

    await expect(sessionStatus()).resolves.toEqual(closed);
    expect(calls).toEqual([{ command: "session_status", args: {} }]);
  });

  it("propaga el error si el backend falla", async () => {
    mockIPC(() => {
      throw new Error("backend caído");
    });

    await expect(sessionStatus()).rejects.toThrow("backend caído");
  });
});
