import type { Command, Ctx } from './Command';
import type { RectPt } from '../engine/PdfEngine';

/** Tacha una línea (línea fina a media altura de la caja); deshacer por snapshot. */
export class StrikethroughRunCmd implements Command {
  readonly id = 'strikethrough-run';
  readonly label = 'Tachar';
  private before: Uint8Array<ArrayBuffer> | null = null;
  constructor(readonly pageIndex: number, readonly box: RectPt, readonly color: [number, number, number] = [0, 0, 0]) {}

  execute(c: Ctx): void {
    this.before = c.engine.save(c.doc);
    const rect: RectPt = { xPt: this.box.xPt, yPt: this.box.yPt + this.box.hPt * 0.45, wPt: this.box.wPt, hPt: Math.max(1, this.box.hPt * 0.08) };
    c.engine.fillRect(c.doc, this.pageIndex, rect, this.color);
    c.refresh();
  }
  async undo(c: Ctx): Promise<void> { if (this.before) await c.reload(this.before); }
}
