import type { Command, Ctx } from './Command';
import type { MarkupKind } from '../engine/PdfEngine';
import type { QuadPt } from '../coords/quads';

const ETIQUETA: Record<MarkupKind, string> = { highlight: 'Resaltar', underline: 'Subrayar', strikeout: 'Tachar' };

/**
 * Resalta, subraya o tacha creando una anotación PDF REAL (`/Highlight`,
 * `/Underline`, `/StrikeOut`) con un quad por línea (pt PDF de usuario). No
 * toca el contenido de la página. Deshacer por snapshot.
 */
export class AddMarkupCmd implements Command {
  readonly id = 'add-markup';
  readonly label: string;
  private before: Uint8Array<ArrayBuffer> | null = null;
  constructor(
    readonly pageIndex: number,
    readonly tipo: MarkupKind,
    readonly quads: readonly QuadPt[],
    readonly color: [number, number, number],
    readonly contenido = '',
    readonly autor = ''
  ) { this.label = ETIQUETA[tipo]; }

  execute(c: Ctx): void {
    this.before = c.engine.save(c.doc);
    c.engine.addMarkup(c.doc, this.pageIndex, this.tipo, this.quads, this.color, this.contenido, this.autor);
    c.refreshPage(this.pageIndex);
  }
  async undo(c: Ctx): Promise<void> { if (this.before) await c.reload(this.before); }
}
