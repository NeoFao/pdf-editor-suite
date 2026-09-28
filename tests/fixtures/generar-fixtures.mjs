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
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

/** CRC32 (tabla estándar) para los chunks PNG. */
function crc32(buf) {
  let c;
  const tabla = crc32.tabla || (crc32.tabla = Array.from({ length: 256 }, (_, n) => {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  }));
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = tabla[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(tipo, data) {
  const t = Buffer.from(tipo, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

/** PNG RGBA de color sólido, sin dependencias externas. */
function pngSolido(w, h, [r, g, b]) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8 bits, color tipo 6 (RGBA)
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    const off = y * (1 + w * 4); raw[off] = 0; // filtro none
    for (let x = 0; x < w; x++) { const p = off + 1 + x * 4; raw[p] = r; raw[p + 1] = g; raw[p + 2] = b; raw[p + 3] = 255; }
  }
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}

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

/**
 * PDF con dos líneas de fuentes, tamaños y colores conocidos, para los tests de
 * fidelidad de la app nueva: al editar una línea debe conservarse su tipografía.
 */
async function pdfFuentes() {
  const doc = await PDFDocument.create();
  const times = await doc.embedFont(StandardFonts.TimesRoman);
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([320, 200]);
  p.drawText('ORIGINAL-TIMES', { x: 40, y: 150, size: 18, font: times, color: rgb(0.85, 0.1, 0.1) });
  p.drawText('linea-helvetica', { x: 40, y: 110, size: 12, font: helv, color: rgb(0, 0, 0) });
  return doc.save();
}

/**
 * PDF con un AcroForm: dos campos de texto ('nombre' vacío, 'ciudad' con valor
 * inicial 'Lima') y una casilla ('acepto') sin marcar, con apariencias
 * generadas — ejercita el relleno de formularios (listFormFields/setFormText/
 * setFormChecked).
 */
async function pdfFormulario() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const p = doc.addPage([320, 260]);
  p.drawText('Formulario de prueba', { x: 20, y: 220, size: 16, font: bold });

  const form = doc.getForm();

  p.drawText('Nombre', { x: 20, y: 185, size: 10, font });
  const nombre = form.createTextField('nombre');
  nombre.addToPage(p, { x: 20, y: 160, width: 260, height: 20 });

  p.drawText('Ciudad', { x: 20, y: 135, size: 10, font });
  const ciudad = form.createTextField('ciudad');
  ciudad.addToPage(p, { x: 20, y: 110, width: 260, height: 20 });
  ciudad.setText('Lima');

  const acepto = form.createCheckBox('acepto');
  acepto.addToPage(p, { x: 20, y: 70, width: 20, height: 20 });
  p.drawText('Acepto los terminos', { x: 46, y: 74, size: 10, font });

  form.updateFieldAppearances(font);
  return doc.save();
}

/**
 * PDF con una línea en una fuente ESTÁNDAR a la que le faltan TODOS los
 * glifos latinos: ZapfDingbats (ISO 32000-1 Anexo D, tabla D.6). No hay
 * ningún .ttf en el repo ni en node_modules que se pueda incrustar como
 * subconjunto sin descargar nada de internet (prohibido por AGENTS.md §5), así
 * que se elige esta vía, sugerida por el propio spec: ZapfDingbats tiene su
 * propia codificación de símbolos y NO cubre el rango latino — el mismo
 * síntoma que sufre un subconjunto real al que le falta un glifo. Verificado
 * con el motor real: `editTextRun` a 'Mañana €' o a CJK ('漢字') devuelve
 * `glyph-missing` sobre este run; pdf-lib ya rechaza codificar letras latinas
 * con esta fuente al generar el fixture, así que el texto original son
 * símbolos dingbat codificables (✁✂✃✄, U+2701-U+2704).
 */
async function pdfSubconjunto() {
  const doc = await PDFDocument.create();
  const dingbats = await doc.embedFont(StandardFonts.ZapfDingbats);
  const p = doc.addPage([320, 200]);
  p.drawText('✁✂✃✄', { x: 40, y: 130, size: 18, font: dingbats, color: rgb(0, 0, 0) });
  return doc.save();
}

async function main() {
  fs.mkdirSync(SALIDA, { recursive: true });
  const archivos = {
    'nativo.pdf': await pdfNativo(),
    'hostil.pdf': await pdfHostil(),
    'apaisado.pdf': await pdfApaisado(),
    'fuentes.pdf': await pdfFuentes(),
    'formulario.pdf': await pdfFormulario(),
    'subconjunto.pdf': await pdfSubconjunto(),
    'rojo.png': pngSolido(16, 16, [255, 0, 0])
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
