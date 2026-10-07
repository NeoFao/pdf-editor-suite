import type { Command, Ctx } from './Command';

/**
 * Cambia el color de un run. Deshacer por SNAPSHOT (E-090): `GenerateContent` de PDFium no regenera `M`/`i`, así que
 * aplicar el color previo dejaba la página regenerada y no la original.
 */
export class SetColorCmd implements Command {
  readonly id = 'set-color';
  readonly label = 'Color del texto';
  private before: Uint8Array<ArrayBuffer> | null = null;

  constructor(
    readonly pageIndex: number,
    readonly runId: number,
    readonly newColor: [number, number, number],
    readonly oldColor: [number, number, number]
  ) {}

  private aplicar(c: Ctx, color: [number, number, number]): void {
    c.engine.setRunColor(c.doc, this.pageIndex, this.runId, color);
    c.refreshPage(this.pageIndex);
  }

  execute(c: Ctx): void {
    this.before = c.engine.save(c.doc);
    this.aplicar(c, this.newColor);
  }

  async undo(c: Ctx): Promise<void> {
    if (this.before) await c.reload(this.before);
    else this.aplicar(c, this.oldColor);
  }
}
