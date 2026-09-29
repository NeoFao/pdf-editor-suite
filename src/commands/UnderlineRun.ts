import type { Command, Ctx } from './Command';
import type { RectPt } from '../engine/PdfEngine';

/** Subraya una línea (línea fina en la base de la caja); deshacer por snapshot. */
export class UnderlineRunCmd implements Command {
  readonly id = 'underline-run';
  readonly label = 'Subrayar';
  private before: Uint8Array<ArrayBuffer> | null = null;
  constructor(readonly pageIndex: number, readonly box: RectPt, readonly color: [number, number, number] = [0, 0, 0]) {}

  execute(c: Ctx): void {
    this.before = c.engine.save(c.doc);
    const rect: RectPt = { xPt: this.box.xPt, yPt: this.box.yPt, wPt: this.box.wPt, hPt: Math.max(1, this.box.hPt * 0.08) };
    c.engine.fillRect(c.doc, this.pageIndex, rect, this.color);
    c.refreshPage(this.pageIndex);
  }
  async undo(c: Ctx): Promise<void> { if (this.before) await c.reload(this.before); }
}
