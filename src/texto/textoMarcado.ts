import type { CommentInfo } from '../engine/PdfEngine';
import type { EditSession } from '../model/EditSession';
import { textoDeMarcado } from './seleccionTexto';

/**
 * Texto que cubre una anotación de marcado (resaltado, subrayado, tachado) en la página `pageIndex`: los caracteres
 * cuya caja cae dentro de algún QuadPoint de la anotación (pt de usuario PDF, sin girar: /Rotate, CropBox y MediaBox
 * ya están resueltos al crear los quads, E-053/E-084). Los caracteres salen de `session.ensureChars` (perezoso y
 * cacheado por página); la normalización de blancos entre líneas es la de `textoDeMarcado` (E-093).
 */
export function textoMarcadoDeAnotacion(session: EditSession, pageIndex: number, c: Pick<CommentInfo, 'index' | 'rectPt'>): string {
  const quads = session.engine.getMarkupQuads(session.doc, pageIndex, c.index);
  return textoDeMarcado(session.ensureChars(pageIndex), { quads, rectPt: c.rectPt });
}
