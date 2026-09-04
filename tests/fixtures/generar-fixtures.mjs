/**
 * Genera los PDF de prueba que consume la suite E2E.
 *
 * Los fixtures NO se versionan: se regeneran de forma determinista antes de
 * cada corrida (`npm run test:fixtures`). Así el repo no acumula binarios y
 * cualquier máquina obtiene exactamente el mismo documento.
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SALIDA = path.join(AQUI, 'generados');

/** Texto de la página 1 del PDF nativo. El orden importa: los tests lo indexan. */
export const LINEAS_NATIVO = [
  'Este documento contiene texto nativo seleccionable.',
  'La segunda linea sirve para probar la edicion in-place.',
  'Tercera linea con numeros: 1234567890 y simbolos.',
  'Cuarta linea para verificar el agrupamiento por renglones.',
  'Quinta linea final del parrafo de prueba.'
];

/** PDF con texto vectorial real: ejercita la capa de Texto Vivo de pdf.js. */
async function pdfNativo() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const p1 = doc.addPage([595.28, 841.89]);
  p1.drawText('Informe Tecnico Trimestral', { x: 60, y: 760, size: 22, font: bold, color: rgb(0.1, 0.1, 0.4) });
  LINEAS_NATIVO.forEach((l, i) => p1.drawText(l, { x: 60, y: 700 - i * 26, size: 12, font }));
  p1.drawText('Seccion 2: Detalles', { x: 60, y: 520, size: 16, font: bold, color: rgb(0.6, 0.1, 0.1) });
  p1.drawText('Contenido de la seccion dos con mas texto.', { x: 60, y: 490, size: 12, font });

  const p2 = doc.addPage([595.28, 841.89]);
  p2.drawText('Pagina 2 - Anexos', { x: 60, y: 760, size: 20, font: bold });
  p2.drawText('Linea de anexo numero uno.', { x: 60, y: 710, size: 12, font });

  return doc.save();
}

/**
 * PDF cuyo texto contiene caracteres que rompen HTML.
 * Fija la regresión de inyección: el texto del PDF nunca se interpreta como
 * marcado (ver docs/ERRORES-CONOCIDOS.md — E-003).
 */
export const TEXTO_HOSTIL = '<img src=x onerror="window.__XSS=1"> A & B <b>negrita</b>';

async function pdfHostil() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([595.28, 841.89]);
  p.drawText(TEXTO_HOSTIL, { x: 40, y: 700, size: 11, font });
  p.drawText('Linea inocente debajo del payload.', { x: 40, y: 670, size: 11, font });
  return doc.save();
}

/** PDF de una sola página muy ancha: ejercita el sizer de zoom. */
async function pdfApaisado() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([1190.55, 841.89]);
  p.drawText('Documento apaisado para probar el zoom.', { x: 60, y: 760, size: 18, font });
  return doc.save();
}

async function main() {
  fs.mkdirSync(SALIDA, { recursive: true });
  const archivos = {
    'nativo.pdf': await pdfNativo(),
    'hostil.pdf': await pdfHostil(),
    'apaisado.pdf': await pdfApaisado()
  };
  for (const [nombre, bytes] of Object.entries(archivos)) {
    fs.writeFileSync(path.join(SALIDA, nombre), bytes);
  }
  console.log(`Fixtures generados en ${SALIDA}: ${Object.keys(archivos).join(', ')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
