import type { Command, Ctx } from './Command';

/**
 * Cambia el tamaño de fuente de un run, conservando la MISMA fuente
 * incrustada (`PdfiumEngine.setRunFontSize` recrea el objeto con el handle
 * de fuente del original, no con un nombre — ver ese comentario). Deshacer
 * por snapshot, igual que `ReplaceRunFontCmd`: el original se elimina y se
 * crea un objeto nuevo, así que no basta con "editar de vuelta".
 *
 * `ok` y `runId` quedan públicos tras `execute()`. `runId` es el del objeto
 * NUEVO tras el cambio — la UI (panel de propiedades) debe reapuntar su
 * selección a él para que un segundo cambio seguido (p. ej. tamaño y luego
 * fuente, o dos cambios de tamaño seguidos) actúe sobre el objeto correcto.
 */
export class SetRunFontSizeCmd implements Command {
  readonly id = 'set-run-font-size';
  readonly label = 'Tamaño de fuente';
  private before: Uint8Array<ArrayBuffer> | null = null;
  ok = false;
  /** runId del run tras el cambio: el nuevo si ok=true, o el original sin tocar si ok=false. */
  runId: number;

  constructor(readonly pageIndex: number, runId: number, readonly sizePt: number) {
    this.runId = runId;
  }

  execute(c: Ctx): void {
    this.before = c.engine.save(c.doc);
    const res = c.engine.setRunFontSize(c.doc, this.pageIndex, this.runId, this.sizePt);
    this.ok = res.ok;
    if (res.ok) {
      this.runId = res.runId;
      c.refresh();
    }
  }

  async undo(c: Ctx): Promise<void> {
    if (this.before) await c.reload(this.before);
  }
}
