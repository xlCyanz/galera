import { describe, expect, it } from "vitest";

import type { Diagnostic } from "../types/diagnostic";
import { countIssues, issuesOf, issuesSummary } from "./issues";

const typst: Diagnostic = {
  severity: "error",
  message: "unclosed delimiter",
  hints: ["cierra el corchete"],
  element_id: "c1",
};
const warning: Diagnostic = { severity: "warning", message: "unknown font", hints: [], element_id: null };

describe("issuesOf", () => {
  it("usa los diagnósticos de Typst tal cual, con su elemento", () => {
    const issues = issuesOf([typst, warning], { kind: "typst", message: "Typst encontró 1 error" });
    expect(issues).toEqual([
      { severity: "error", message: "unclosed delimiter", hints: ["cierra el corchete"], elementId: "c1" },
      { severity: "warning", message: "unknown font", hints: [], elementId: null },
    ]);
  });

  it("sin error, los avisos de una compilación buena", () => {
    expect(issuesOf([warning], null)).toHaveLength(1);
    expect(issuesOf([], null)).toEqual([]);
  });

  it("un error de validación da un problema por elemento o página", () => {
    const issues = issuesOf([], {
      kind: "invalid",
      message: "el documento tiene 2 problemas",
      problems: [
        { location: { kind: "element", id: "r1" }, message: "w tiene que ser mayor que cero, y es -3" },
        { location: { kind: "page", id: "p 1" }, message: "el id no es válido" },
      ],
    });
    expect(issues).toEqual([
      { severity: "error", message: "w tiene que ser mayor que cero, y es -3", hints: [], elementId: "r1" },
      { severity: "error", message: "página «p 1»: el id no es válido", hints: [], elementId: null },
    ]);
  });

  it("cualquier otro error, con su mensaje", () => {
    const issues = issuesOf([], { kind: "world", message: "falta la fuente fonts/Inter.ttf" });
    expect(issues).toEqual([
      { severity: "error", message: "falta la fuente fonts/Inter.ttf", hints: [], elementId: null },
    ]);
  });
});

describe("resumen", () => {
  it("cuenta errores y avisos", () => {
    const issues = issuesOf([typst, warning, warning], null);
    expect(countIssues(issues)).toEqual({ errors: 1, warnings: 2 });
    expect(issuesSummary(issues)).toBe("1 error y 2 avisos");
    expect(issuesSummary(issuesOf([typst, typst], null))).toBe("2 errores");
    expect(issuesSummary(issuesOf([warning], null))).toBe("1 aviso");
    expect(issuesSummary([])).toBeNull();
  });
});
