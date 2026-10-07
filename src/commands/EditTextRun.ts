import type { Command, Ctx } from './Command';

/**
 * Edita el texto de un run, de forma fiel (el motor conserva fuente/tamaño/color/posición).
 *
 * Deshacer por SNAPSHOT (E-090): `GenerateContent` de PDFium no regenera el estado gráfico `M` (límite de inglete) ni
 * `i` (planitud), así que re-editar "de vuelta" dejaba la página regenerada, no la original. `before` son los bytes del
 * documento ANTES de la edición: la UI, que aplica la edición antes de registrar el comando (`pushExecuted`), los
 * toma y los pasa; `execute()` los toma él mismo. Sin `before`, deshacer cae a re-editar en sitio.
 */
export class EditTextRunCmd implements Command {
  readonly id = 'edit-text-run';
  readonly label = 'Editar texto';
  readonly coalesceKey: string;

  constructor(
    readonly pageIndex: number,
    readonly runId: number,
    readonly newText: string,
    readonly oldText: string,
    private before: Uint8Array<ArrayBuffer> | null = null
  ) {
    this.coalesceKey = `edit:${pageIndex}:${runId}`;
  }

  execute(c: Ctx): void {
    this.before = c.engine.save(c.doc);
    c.engine.editTextRun(c.doc, this.pageIndex, this.runId, this.newText);
    c.model.updateRunText(this.pageIndex, this.runId, this.newText);
  }

  async undo(c: Ctx): Promise<void> {
    if (this.before) { await c.reload(this.before); return; }
    c.engine.editTextRun(c.doc, this.pageIndex, this.runId, this.oldText);
    c.model.updateRunText(this.pageIndex, this.runId, this.oldText);
  }

  coalesce(prev: Command): Command | null {
    if (prev instanceof EditTextRunCmd && prev.pageIndex === this.pageIndex && prev.runId === this.runId) {
      // Fusionado: conserva el oldText y el snapshot del PRIMER comando (el estado original) y aplica el newText más reciente.
      return new EditTextRunCmd(this.pageIndex, this.runId, this.newText, prev.oldText, prev.before ?? this.before);
    }
    return null;
  }
}
