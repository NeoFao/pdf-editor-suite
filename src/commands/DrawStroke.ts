import type { Command, Ctx } from './Command';

export interface StrokePoint { xPt: number; yPt: number }

/** Trazo a mano alzada; deshacer por snapshot. */
export class DrawStrokeCmd implements Command {
  readonly id = 'draw-stroke';
  readonly label = 'Dibujar';
  private before: Uint8Array<ArrayBuffer> | null = null;
  constructor(
    readonly pageIndex: number,
    readonly points: StrokePoint[],
    readonly color: [number, number, number] = [220, 20, 20],
    readonly widthPt = 2
  ) {}

  execute(c: Ctx): void {
    this.before = c.engine.save(c.doc);
    c.engine.drawStroke(c.doc, this.pageIndex, this.points, this.color, this.widthPt);
    c.refresh();
  }
  async undo(c: Ctx): Promise<void> { if (this.before) await c.reload(this.before); }
}
