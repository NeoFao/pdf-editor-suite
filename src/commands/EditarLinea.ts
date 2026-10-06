import type { LineaParaEditar } from '../engine/PdfEngine';
import type { Command, Ctx } from './Command';

/**
 * Edita una LÍNEA EDITABLE compuesta (varios objetos de texto, N1) con el diff mínimo del motor (`engine.editLine`):
 * el prefijo no se toca, el tramo cambiado se reescribe en sitio, los objetos sobrantes se eliminan y el sufijo se
 * traslada. Deshacer por SNAPSHOT: desactivar los objetos no sirve como borrado reversible (los inactivos
 * no se escriben en `GenerateContent` y la siguiente carga de la página ya no los tiene) y PDFium no clona objetos;
 * como `ReplaceRunFontCmd` y `DeleteRunCmd`, se guarda el documento antes y se recarga al deshacer. Rehacer vuelve a
 * ejecutar `editLine`, que es determinista sobre el documento recargado.
 *
 * Una línea de UN solo objeto no pasa por aquí: sigue por `EditTextRunCmd` (en sitio, sin snapshot).
 *
 * Tras `execute()`: `ok` (se aplicó), `sinCambios` (el texto era igual), `fontName` (fuente estándar usada para el
 * tramo si a la original le faltaba algún glifo, E-047), `razon` (si falló) y `lineaRunIdInicial` (índice del primer
 * objeto de la línea, para reapuntar la selección).
 */
export class EditarLineaCmd implements Command {
  readonly id = 'editar-linea';
  readonly label = 'Editar texto';
  private before: Uint8Array<ArrayBuffer> | null = null;
  ok = false;
  sinCambios = false;
  fontName: string | null = null;
  razon: 'glyph-missing' | 'not-a-text-run' | 'empty-text' | 'stale' | null = null;
  lineaRunIdInicial: number;

  constructor(readonly pageIndex: number, readonly linea: LineaParaEditar, readonly textoNuevo: string) {
    this.lineaRunIdInicial = linea.runIds[0] ?? -1;
  }

  execute(c: Ctx): void {
    this.ok = false;
    this.sinCambios = false;
    this.fontName = null;
    this.razon = null;
    if (this.textoNuevo === this.linea.text) { this.ok = true; this.sinCambios = true; return; }
    const antes = c.engine.save(c.doc);
    let res = c.engine.editLine(c.doc, this.pageIndex, this.linea, this.textoNuevo);
    // E-047: a la fuente original le falta algún glifo del tramo nuevo → ese tramo (no la línea entera) en la estándar.
    if (!res.ok && res.reason === 'glyph-missing') res = c.engine.editLine(c.doc, this.pageIndex, this.linea, this.textoNuevo, { fuenteEstandar: true });
    if (!res.ok) { this.razon = res.reason; return; }
    this.ok = true;
    if ('sinCambios' in res) { this.sinCambios = true; return; }
    this.before = antes;
    this.lineaRunIdInicial = res.lineaRunIdInicial;
    this.fontName = res.fuenteEstandar ?? null;
    c.refreshPage(this.pageIndex);
  }

  async undo(c: Ctx): Promise<void> {
    if (this.before) await c.reload(this.before);
  }
}
