import type { Command, Ctx } from './Command';

/**
 * Mueve un run por (dxPt, dyPt). Deshacer por SNAPSHOT (E-090: mover regenera el content stream y PDFium no escribe `M`/`i`; el delta inverso no devolvía
 * la página original). Una línea editable compuesta
 * (N1) pasa `runIds` con TODOS sus objetos: se mueven juntos en una sola carga de página.
 */
export class MoveRunCmd implements Command {
  readonly id = 'move-run';
  readonly label = 'Mover texto';
  private before: Uint8Array<ArrayBuffer> | null = null;
  readonly runIds: readonly number[];

  constructor(
    readonly pageIndex: number,
    readonly runId: number,
    readonly dxPt: number,
    readonly dyPt: number,
    runIds?: readonly number[]
  ) {
    this.runIds = runIds && runIds.length > 0 ? runIds : [runId];
  }

  private aplicar(c: Ctx, dx: number, dy: number): void {
    if (this.runIds.length > 1) c.engine.moveRuns(c.doc, this.pageIndex, this.runIds, dx, dy);
    else c.engine.moveRun(c.doc, this.pageIndex, this.runId, dx, dy);
    c.refreshPage(this.pageIndex);
  }

  execute(c: Ctx): void {
    this.before = c.engine.save(c.doc);
    this.aplicar(c, this.dxPt, this.dyPt);
  }

  async undo(c: Ctx): Promise<void> {
    if (this.before) await c.reload(this.before);
    else this.aplicar(c, -this.dxPt, -this.dyPt);
  }
}
