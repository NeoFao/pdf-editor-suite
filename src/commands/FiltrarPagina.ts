import type { Command, Ctx } from './Command';
import { escalaDeGrises, blancoYNegro, colorMagico } from '../image/filtros';

export type TipoFiltro = 'grises' | 'bn' | 'magico';

function aplicarFiltro(filtro: TipoFiltro, rgba: Uint8ClampedArray): Uint8ClampedArray {
  switch (filtro) {
    case 'grises': return escalaDeGrises(rgba);
    case 'bn': return blancoYNegro(rgba);
    case 'magico': return colorMagico(rgba);
  }
}

/**
 * Aplica un filtro de imagen (#25 de la tabla de paridad, §9) a TODAS las
 * imágenes de una página. A diferencia de la app vieja (`applyFilterToCurrentPage`
 * en `js/app.js`), que rasteriza la página entera y pinta el filtro sobre ese
 * canvas, este comando actúa solo sobre los objetos imagen del PDF
 * (`getImagePixels`/`replaceImagePixels`): el texto y los vectores de la
 * página quedan intactos, vectoriales y seleccionables. Deshacer por
 * snapshot (restaura el documento previo), igual que `InsertImageCmd`: no
 * hay operación inversa simple para un filtro con pérdida de información
 * (p. ej. blanco y negro no se puede "desaplicar").
 */
export class FiltrarPaginaCmd implements Command {
  readonly id = 'filtrar-pagina';
  readonly label = 'Aplicar filtro';
  private before: Uint8Array<ArrayBuffer> | null = null;
  /** Nº de imágenes de la página a las que se aplicó el filtro en la última ejecución. */
  imagenesAfectadas = 0;

  constructor(readonly pageIndex: number, readonly filtro: TipoFiltro) {}

  async execute(c: Ctx): Promise<void> {
    this.before = c.engine.save(c.doc);
    const imgs = c.engine.listImageObjects(c.doc, this.pageIndex);
    let afectadas = 0;
    for (const img of imgs) {
      const pix = c.engine.getImagePixels(c.doc, this.pageIndex, img.objIndex);
      if (!pix) continue; // formato de bitmap no soportado: se deja tal cual
      const entrada = new Uint8ClampedArray(pix.rgba.buffer, pix.rgba.byteOffset, pix.rgba.byteLength);
      const filtrado = aplicarFiltro(this.filtro, entrada);
      const rgbaFiltrado = new Uint8Array(filtrado.buffer, filtrado.byteOffset, filtrado.byteLength);
      if (c.engine.replaceImagePixels(c.doc, this.pageIndex, img.objIndex, rgbaFiltrado, pix.width, pix.height)) {
        afectadas++;
      }
    }
    this.imagenesAfectadas = afectadas;
    if (afectadas > 0) {
      // Compactar: ver el comentario equivalente en ComprimirDocumentoCmd —
      // replaceImagePixels deja el stream anterior de cada imagen huérfano
      // pero igualmente serializado por save(); reabrir desde los propios
      // bytes lo descarta.
      await c.reload(c.engine.save(c.doc));
    } else {
      c.refreshPage(this.pageIndex);
    }
  }

  async undo(c: Ctx): Promise<void> { if (this.before) await c.reload(this.before); }
}
