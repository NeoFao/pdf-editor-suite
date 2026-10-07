/**
 * `/UserUnit` (PDF 1.6): tamaño físico de la unidad de usuario de una página, en múltiplos de 1/72". PDFium lo ignora
 * (tamaño, render y coordenadas van en unidades de usuario sin escalar, E-098) y no expone el diccionario de página, así
 * que se lee aquí con pdf-lib y solo cuando hace falta. El valor es solo para la VISTA (E-099): las coordenadas del motor
 * no se escalan nunca.
 */
import { PDFDict, PDFDocument, PDFName, PDFNumber, ParseSpeeds } from 'pdf-lib';

/** Por encima de este tamaño no se analiza el fichero: abrir un PDF enorme no debe pagar una segunda lectura completa. */
const MAX_BYTES_ANALISIS = 64 * 1024 * 1024;

/** Valor válido de `/UserUnit`: finito y > 0; cualquier otra cosa (falta, 0, negativo, NaN) se trata como 1. */
export function userUnitValido(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 1;
}

/**
 * Número de objeto de cada página con `/UserUnit` ≠ 1 → su valor. Las páginas ausentes del mapa valen 1. Se indexa por número
 * de objeto (no por posición) para que reordenar o borrar páginas no desplace los valores. Atajo: sin la cadena `UserUnit` ni
 * flujos de objetos comprimidos (`/ObjStm`, donde podría ir el diccionario) no hay nada que leer y no se carga pdf-lib.
 */
export async function leerUserUnits(bytes: Uint8Array): Promise<Map<number, number>> {
  const res = new Map<number, number>();
  if (bytes.length > MAX_BYTES_ANALISIS) return res;
  const texto = new TextDecoder('latin1').decode(bytes);
  if (!texto.includes('UserUnit') && !texto.includes('/ObjStm')) return res;
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false, throwOnInvalidObject: false, parseSpeed: ParseSpeeds.Fastest });
    const tipo = PDFName.of('Type'), clave = PDFName.of('UserUnit'), pagina = PDFName.of('Page');
    for (const [ref, obj] of doc.context.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFDict) || obj.get(tipo) !== pagina) continue;
      const n = doc.context.lookup(obj.get(clave));
      const v = userUnitValido(n instanceof PDFNumber ? n.asNumber() : undefined);
      if (v !== 1) res.set(ref.objectNumber, v);
    }
  } catch {
    // Fichero que pdf-lib no entiende pero PDFium sí: la vista sigue en tamaño sin escalar (UserUnit 1).
  }
  return res;
}
