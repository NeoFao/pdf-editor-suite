import type { Command, Ctx } from './Command';

/** Edita el texto de un run, de forma fiel (el motor conserva fuente/tamaño/color/posición). */
export class EditTextRunCmd implements Command {
  readonly id = 'edit-text-run';
  readonly label = 'Editar texto';
  readonly coalesceKey: string;

  constructor(
    readonly pageIndex: number,
    readonly runId: number,
    readonly newText: string,
    readonly oldText: string
  ) {
    this.coalesceKey = `edit:${pageIndex}:${runId}`;
  }

  execute(c: Ctx): void {
    c.engine.editTextRun(c.doc, this.pageIndex, this.runId, this.newText);
    c.model.updateRunText(this.pageIndex, this.runId, this.newText);
  }

  undo(c: Ctx): void {
    c.engine.editTextRun(c.doc, this.pageIndex, this.runId, this.oldText);
    c.model.updateRunText(this.pageIndex, this.runId, this.oldText);
  }

  coalesce(prev: Command): Command | null {
    if (prev instanceof EditTextRunCmd && prev.pageIndex === this.pageIndex && prev.runId === this.runId) {
      // Fusionado: conserva el oldText original y aplica el newText más reciente.
      return new EditTextRunCmd(this.pageIndex, this.runId, this.newText, prev.oldText);
    }
    return null;
  }
}
