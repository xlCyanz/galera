/**
 * Los problemas de la última compilación, en una sola lista para la
 * interfaz, vengan de donde vengan:
 *
 * - **diagnósticos de Typst**, con su mensaje literal, sus sugerencias y, si
 *   se sabe, el elemento en el que ocurren;
 * - **problemas de validación**, uno por página o elemento;
 * - cualquier otro error (una fuente que falta, por ejemplo), con su mensaje.
 */
import type { CommandError } from "../commands";
import type { Diagnostic, Severity } from "../types/diagnostic";

export interface Issue {
  severity: Severity;
  /** El mensaje tal cual: el de Typst, sin retocar. */
  message: string;
  /** Sugerencias de Typst para arreglarlo. */
  hints: string[];
  /** El elemento del documento al que se refiere, si se sabe. */
  elementId: string | null;
}

/** La lista de problemas a partir de lo que guarda el store de compilación. */
export function issuesOf(diagnostics: readonly Diagnostic[], error: CommandError | null): Issue[] {
  const fromTypst = diagnostics.map<Issue>((diagnostic) => ({
    severity: diagnostic.severity,
    message: diagnostic.message,
    hints: diagnostic.hints,
    elementId: diagnostic.element_id,
  }));
  if (error === null || fromTypst.length > 0) {
    return fromTypst;
  }

  const problems = error.problems ?? [];
  if (problems.length > 0) {
    return problems.map((problem) => ({
      severity: "error",
      message:
        problem.location.kind === "page"
          ? `página «${problem.location.id}»: ${problem.message}`
          : problem.message,
      hints: [],
      elementId: problem.location.kind === "element" ? problem.location.id : null,
    }));
  }
  return [{ severity: "error", message: error.message, hints: [], elementId: null }];
}

/** Cuántos errores y avisos hay. */
export function countIssues(issues: readonly Issue[]): { errors: number; warnings: number } {
  const errors = issues.filter((issue) => issue.severity === "error").length;
  return { errors, warnings: issues.length - errors };
}

/** «1 error», «3 avisos», «2 errores y 1 aviso», o `null` si no hay nada. */
export function issuesSummary(issues: readonly Issue[]): string | null {
  const { errors, warnings } = countIssues(issues);
  const parts = [
    errors > 0 ? `${errors} ${errors === 1 ? "error" : "errores"}` : null,
    warnings > 0 ? `${warnings} ${warnings === 1 ? "aviso" : "avisos"}` : null,
  ].filter((part) => part !== null);
  return parts.length === 0 ? null : parts.join(" y ");
}
