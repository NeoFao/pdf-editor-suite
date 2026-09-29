import type { Command, Ctx } from './Command';
import type { RectPt } from '../engine/PdfEngine';

/** Rectángulo (solo borde); deshacer por snapshot, igual que DrawStrokeCmd. */
export class DrawRectCmd implements Command {
  readonly id = 'draw-rect';
  readonly label = 'Rectángulo';
  private before: Uint8Array<ArrayBuffer> | null = null;
  constructor(
    readonly pageIndex: number,
    readonly rect: RectPt,
    readonly color: [number, number, number] = [220, 20, 20],
    readonly widthPt = 2
  ) {}

  execute(c: Ctx): void {
    this.before = c.engine.save(c.doc);
    c.engine.drawRect(c.doc, this.pageIndex, this.rect, this.color, this.widthPt);
    c.refresh();
  }
  async undo(c: Ctx): Promise<void> { if (this.before) await c.reload(this.before); }
}
