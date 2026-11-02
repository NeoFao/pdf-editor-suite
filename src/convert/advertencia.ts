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

/** Un carácter afectado por un aviso de codificación: el carácter, su código `U+XXXX` y cuántas veces aparece. */
export interface CaracterAfectado {
  caracter: string;
  codigo: string;
  veces: number;
}

/**
 * Identificador estable de los avisos que la UI o los tests deben poder reconocer sin leer el texto (E-120):
 *  - `caracteresSinFuente`: caracteres sin glifo en las fuentes estándar; se dibujan como `?`.
 *  - `caracteresControl`: caracteres de control (U+0000...) eliminados antes de llegar al motor.
 */
export type CodigoAdvertencia = 'caracteresSinFuente' | 'caracteresControl';

export interface Advertencia {
  tipo: TipoAdvertencia;
  mensaje: string;
  /** Solo en avisos con identidad propia (ver `CodigoAdvertencia`). */
  codigo?: CodigoAdvertencia;
  /** Detalle de los caracteres afectados (únicos, hasta 20), en orden de primera aparición. */
  caracteres?: readonly CaracterAfectado[];
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
