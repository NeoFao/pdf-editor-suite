/**
 * Advertencia de una conversión "otro formato → PDF" (T13). Dos clases con
 * consecuencias distintas para el usuario, que la UI muestra en grupos
 * separados:
 *  - `omitido`: el contenido NO aparece en el PDF (imagen que no se pudo
 *    insertar, nota al pie, ecuación...).
 *  - `aproximado`: el contenido SÍ aparece, pero distinto del original
 *    (flotante sin ajuste de texto, tabla escalada, enlace sin clic...).
 * Tipar en el origen evita que un mensaje cuente "omitió" cuando el contenido
 * está en el PDF (limitación de T6).
 */
export type TipoAdvertencia = 'omitido' | 'aproximado';

export interface Advertencia {
  tipo: TipoAdvertencia;
  mensaje: string;
}

export const omitido = (mensaje: string): Advertencia => ({ tipo: 'omitido', mensaje });
export const aproximado = (mensaje: string): Advertencia => ({ tipo: 'aproximado', mensaje });

/** Solo los textos, en el mismo orden (útil en tests y para registrar en consola). */
export function textosAdvertencias(a: readonly Advertencia[]): string[] {
  return a.map((x) => x.mensaje);
}

/** Reparte las advertencias en los dos grupos que muestra la UI, conservando el orden dentro de cada uno. */
export function agruparAdvertencias(a: readonly Advertencia[]): { omitidas: Advertencia[]; aproximadas: Advertencia[] } {
  return { omitidas: a.filter((x) => x.tipo === 'omitido'), aproximadas: a.filter((x) => x.tipo === 'aproximado') };
}
