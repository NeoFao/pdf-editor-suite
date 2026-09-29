import type { Command, Ctx } from './Command';

/**
 * Cambia la fuente de un run a una de las 14 fuentes estándar PDF elegida
 * por el usuario en el panel de propiedades, conservando el texto ACTUAL del
 * run (a diferencia de `ReplaceRunFontCmd`, que sustituye la fuente Y el
 * texto porque viene de una edición con glifo faltante). Deshacer por
 * snapshot, mismo motivo que `ReplaceRunFontCmd`/`SetRunFontSizeCmd`: el
 * original se elimina y se crea un objeto nuevo.
 *
 * `ok`, `fontName` y `runId` quedan públicos tras `execute()`. `runId` es el
 * del objeto NUEVO — la UI debe reapuntar su selección a él.
 */
export class SetRunFontCmd implements Command {
  readonly id = 'set-run-font';
  readonly label = 'Fuente';
  private before: Uint8Array<ArrayBuffer> | null = null;
  ok = false;
  fontName: string | null = null;
  /** runId del run tras el cambio: el nuevo si ok=true, o el original sin tocar si ok=false. */
  runId: number;

  constructor(readonly pageIndex: number, runId: number, readonly standardFontName: string) {
    this.runId = runId;
  }

  execute(c: Ctx): void {
    this.before = c.engine.save(c.doc);
    const res = c.engine.setRunFont(c.doc, this.pageIndex, this.runId, this.standardFontName);
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
