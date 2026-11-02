/**
 * Errores tipados de apertura (E-125). PDFium informa del motivo de un `FPDF_LoadMemDocument` fallido con
 * `FPDF_GetLastError`; aquí se traduce a un código estable que la interfaz convierte en un mensaje claro.
 * Ningún mensaje de este módulo contiene la contraseña ni datos del documento.
 */
export type CodigoErrorPdf = 'FILE' | 'FORMAT' | 'PASSWORD' | 'SECURITY' | 'PAGE' | 'CLOSED' | 'UNKNOWN';

export class PdfError extends Error {
  constructor(readonly codigo: CodigoErrorPdf, mensaje: string) {
    super(mensaje);
    this.name = 'PdfError';
  }
}

/** Códigos de `FPDF_GetLastError` (fpdfview.h: FPDF_ERR_*). */
export function errorDeCodigoPdfium(codigo: number): PdfError {
  switch (codigo) {
    case 2: return new PdfError('FILE', 'No se pudo leer el archivo');
    case 3: return new PdfError('FORMAT', 'El archivo no es un PDF válido o está dañado');
    case 4: return new PdfError('PASSWORD', 'El PDF necesita contraseña, o la indicada no es correcta');
    case 5: return new PdfError('SECURITY', 'El PDF usa un cifrado no soportado');
    case 6: return new PdfError('PAGE', 'No se pudo cargar una página del PDF');
    default: return new PdfError('UNKNOWN', 'No se pudo abrir el PDF');
  }
}
