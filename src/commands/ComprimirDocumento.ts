import type { Command, Ctx } from './Command';
import { planDeCompresion, tieneCanalAlfa, type OpcionesCompresion } from '../image/comprimir';
import { adaptadorImagenNavegador, type AdaptadorImagen } from '../ui/adaptadorImagenNavegador';

export interface InformeCompresion { antesBytes: number; despuesBytes: number; imagenes: number }

/**
 * Comprime el documento entero (#29 de la tabla de paridad, §9) actuando
 * SOLO sobre los objetos imagen de cada página — a diferencia de la app
 * vieja (`executeCompression` en `js/app.js`), que rasteriza cada página
 * completa a JPEG (perdiendo el texto vectorial), aquí el texto y los
 * vectores no se tocan. Para cada imagen:
 *
 * 1. Si su DPI efectivo supera `opciones.dpiMax` (`planDeCompresion`), se
 *    reescala primero (bitmap, vía el adaptador del navegador).
 * 2. Si NO tiene transparencia real, se recodifica a JPEG con
 *    `opciones.calidad` y se incrusta con `replaceImageJpeg` — salvo que el
 *    JPEG resultante saliera MÁS pesado que el stream que ya había
 *    (`getImageRawSize`), en cuyo caso se conserva tal cual (o, si sí hacía
 *    falta reescalar, se deja el reescalado como bitmap sin JPEG: sigue
 *    pesando menos por tener menos píxeles).
 * 3. Si SÍ tiene transparencia (canal alfa real, típicamente una máscara
 *    /SMask), NUNCA se pasa a JPEG —formato sin canal alfa, se perdería la
 *    transparencia—: solo se reescala como bitmap si hacía falta.
 *
 * Deshacer por snapshot (restaura el documento previo): recorre y sustituye
 * imágenes de varias páginas, no hay operación inversa simple.
 */
export class ComprimirDocumentoCmd implements Command {
  readonly id = 'comprimir-documento';
  readonly label = 'Comprimir documento';
  private before: Uint8Array<ArrayBuffer> | null = null;
  /** Informe de la última ejecución: bytes del documento antes/después y nº de imágenes tocadas. */
  informe: InformeCompresion = { antesBytes: 0, despuesBytes: 0, imagenes: 0 };

  constructor(readonly opciones: OpcionesCompresion, private readonly adaptador: AdaptadorImagen = adaptadorImagenNavegador) {}

  async execute(c: Ctx): Promise<void> {
    const before = c.engine.save(c.doc);
    this.before = before;
    let tocadas = 0;
    const totalPaginas = c.engine.pageCount(c.doc);

    for (let pageIndex = 0; pageIndex < totalPaginas; pageIndex++) {
      const imgs = c.engine.listImageObjects(c.doc, pageIndex);
      for (const img of imgs) {
        const pix = c.engine.getImagePixels(c.doc, pageIndex, img.objIndex);
        if (!pix) continue; // formato de bitmap no soportado: se deja tal cual

        let rgba = new Uint8ClampedArray(pix.rgba.buffer, pix.rgba.byteOffset, pix.rgba.byteLength);
        let width = pix.width, height = pix.height;
        const alfaOriginal = tieneCanalAlfa(rgba);

        const [plan] = planDeCompresion(
          [{ objIndex: img.objIndex, widthPx: width, heightPx: height, wPt: img.rectPt.wPt, hPt: img.rectPt.hPt, tieneAlfa: alfaOriginal }],
          this.opciones
        );

        if (plan!.reescalar) {
          const r = await this.adaptador.reescalar(rgba, width, height, plan!.targetWidthPx, plan!.targetHeightPx);
          rgba = r.rgba; width = r.width; height = r.height;
        }

        if (alfaOriginal) {
          // Transparencia real: nunca a JPEG. Si tocaba reescalar, se aplica
          // como bitmap; si no, no hay nada más que hacer con esta imagen.
          if (plan!.reescalar) {
            const rgbaU8 = new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength);
            if (c.engine.replaceImagePixels(c.doc, pageIndex, img.objIndex, rgbaU8, width, height)) tocadas++;
          }
          continue;
        }

        const jpegBytes = await this.adaptador.codificarJpeg(rgba, width, height, this.opciones.calidad);
        const original = c.engine.getImageRawSize(c.doc, pageIndex, img.objIndex) ?? Infinity;
        if (jpegBytes.length < original) {
          if (c.engine.replaceImageJpeg(c.doc, pageIndex, img.objIndex, jpegBytes)) tocadas++;
        } else if (plan!.reescalar) {
          // El JPEG no ayudó, pero el reescalado (menos píxeles) sigue reduciendo el peso.
          const rgbaU8 = new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength);
          if (c.engine.replaceImagePixels(c.doc, pageIndex, img.objIndex, rgbaU8, width, height)) tocadas++;
        }
        // Si no hacía falta reescalar y el JPEG salía más pesado: se conserva la imagen tal cual.
      }
    }

    if (tocadas > 0) {
      // Compactar: sustituir el bitmap/JPEG de una imagen (motor) deja el
      // stream ANTERIOR huérfano en la tabla de objetos del documento, que
      // el motor lo sigue serializando al guardar aunque ya no lo
      // referencie nada, así que un save() directo tras sustituir imágenes
      // NO reduce el peso del archivo (se comprobó: una imagen de 233 KB
      // sustituida por un JPEG de 700 B daba un documento de todos modos
      // ~234 KB). Reabrir desde los propios
      // bytes recién guardados reconstruye el documento solo con lo que de
      // verdad se referencia, descartando esos huérfanos — el mismo
      // documento reabierto y vuelto a guardar pesaba ~2 KB en esa prueba.
      const bytesConHuerfanos = c.engine.save(c.doc);
      await c.reload(bytesConHuerfanos);
    }

    // saveCompact (E-038, docs/ERRORES-CONOCIDOS.md): el tamaño que se
    // informa aquí es el que se llevará el usuario al pulsar Guardar (que
    // también usa saveCompact) — un save() a secas podría seguir arrastrando
    // huérfanos de ediciones anteriores a la compresión (texto, trazos...)
    // que no tienen nada que ver con las imágenes que tocó este comando.
    const after = await c.engine.saveCompact(c.doc);
    this.informe = { antesBytes: before.length, despuesBytes: after.length, imagenes: tocadas };
    if (tocadas === 0) c.refresh(); // si hubo reload, ya refrescó c.reload() por dentro
  }

  async undo(c: Ctx): Promise<void> { if (this.before) await c.reload(this.before); }
}
