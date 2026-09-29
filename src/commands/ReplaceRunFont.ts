import type { Command, Ctx } from './Command';

/**
 * Sustituye la fuente de un run por la estándar PDF más parecida cuando
 * `editTextRun` no pudo aplicar el texto nuevo (`glyph-missing`: el
 * subconjunto incrustado no trae ese glifo). Deshacer por snapshot —el
 * original se elimina y se crea un objeto nuevo, así que no basta con
 * "editar de vuelta" como en `EditTextRunCmd`— igual que `InsertImageCmd`/
 * `AddNoteCmd`.
 *
 * `ok` y `fontName` quedan públicos tras `execute()` para que la UI sepa si
 * la sustitución funcionó y con qué fuente, sin tener que releer el motor.
 */
export class ReplaceRunFontCmd implements Command {
  readonly id = 'replace-run-font';
  readonly label = 'Sustituir fuente';
  private before: Uint8Array<ArrayBuffer> | null = null;
  ok = false;
  fontName: string | null = null;
  /** runId del objeto nuevo tras la sustitución (el original se elimina). */
  runId: number;

  constructor(readonly pageIndex: number, runId: number, readonly newText: string) {
    this.runId = runId;
  }

  execute(c: Ctx): void {
    this.before = c.engine.save(c.doc);
    const res = c.engine.replaceRunWithStandardFont(c.doc, this.pageIndex, this.runId, this.newText);
    this.ok = res.ok;
    if (res.ok) {
      this.fontName = res.fontName;
      this.runId = res.runId;
      c.refreshPage(this.pageIndex);
    }
  }

  async undo(c: Ctx): Promise<void> {
    if (this.before) await c.reload(this.before);
  }
}
