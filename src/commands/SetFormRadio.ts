import type { Command, Ctx } from './Command';

/**
 * Marca un widget de un grupo de radio (y desmarca al resto del grupo — lo
 * resuelve `PdfEngine.setFormRadio`). Deshacer por operación inversa: vuelve a
 * marcar el widget que estaba marcado antes (`prevAnnotIndex`), o si no había
 * ninguno, deja el grupo entero en Off (`clearFormRadio`, que acepta
 * cualquier widget del mismo grupo — el valor `/V` es del campo, no del
 * widget). Sin coalescer: cada clic en un radio distinto es un paso de
 * deshacer propio.
 */
export class SetFormRadioCmd implements Command {
  readonly id = 'set-form-radio';
  readonly label = 'Botón de opción';

  constructor(
    readonly pageIndex: number,
    readonly annotIndex: number,
    readonly prevAnnotIndex: number | null
  ) {}

  execute(c: Ctx): void {
    c.engine.setFormRadio(c.doc, this.pageIndex, this.annotIndex);
    c.refreshPage(this.pageIndex);
  }

  undo(c: Ctx): void {
    if (this.prevAnnotIndex !== null) {
      c.engine.setFormRadio(c.doc, this.pageIndex, this.prevAnnotIndex);
    } else {
      c.engine.clearFormRadio(c.doc, this.pageIndex, this.annotIndex);
    }
    c.refreshPage(this.pageIndex);
  }
}
