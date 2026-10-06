/**
 * Genera los PDF de prueba que consume la suite E2E.
 *
 * Los fixtures NO se versionan: se regeneran de forma determinista antes de
 * cada corrida (`npm run test:fixtures`). Así el repo no acumula binarios y
 * cualquier máquina obtiene exactamente el mismo documento.
 */
import { PDFDocument, StandardFonts, rgb, degrees, PDFName, PDFHexString, PDFString } from 'pdf-lib';
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

/**
 * PNG RGBA de una "firma" sobre fondo blanco opaco: un trazo negro diagonal
 * (grosor unos pocos píxeles) sobre fondo blanco puro. Para el test E2E de
 * "firma desde imagen quitando el fondo" (#20 de la tabla de paridad): el
 * fondo blanco debe desaparecer (quitarFondo) y el trazo negro conservarse.
 */
function pngFirma(w, h) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8 bits, color tipo 6 (RGBA)
  const raw = Buffer.alloc(h * (1 + w * 4));
  const grosor = Math.max(2, Math.round(Math.min(w, h) * 0.08));
  for (let y = 0; y < h; y++) {
    const off = y * (1 + w * 4); raw[off] = 0; // filtro none
    for (let x = 0; x < w; x++) {
      const p = off + 1 + x * 4;
      // Trazo diagonal: negro cerca de la línea x/w === y/h, blanco el resto.
      const distancia = Math.abs(x / w - y / h) * Math.min(w, h);
      const trazo = distancia < grosor;
      const val = trazo ? 0 : 255;
      raw[p] = val; raw[p + 1] = val; raw[p + 2] = val; raw[p + 3] = 255;
    }
  }
  return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}

/**
 * PNG RGBA que imita una página escaneada: degradado suave (luz de escáner
 * desigual) + ruido pseudoaleatorio determinista (mulberry32 con semilla
 * fija, para que el fixture sea reproducible — no `Math.random()`). Sirve
 * para el E2E de filtros/compresión (lote E, §9 #25 y #29): una imagen
 * fotográfica de verdad, no un color sólido (que Flate comprimiría casi a
 * nada y no serviría para medir una reducción de peso real).
 */
function pngEscaneado(w, h) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8 bits, color tipo 6 (RGBA)
  const raw = Buffer.alloc(h * (1 + w * 4));
  let seed = 0x9e3779b9;
  const siguiente = () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let y = 0; y < h; y++) {
    const off = y * (1 + w * 4); raw[off] = 0; // filtro none
    const filaBase = Math.round((y / (h - 1)) * 60);
    for (let x = 0; x < w; x++) {
      const p = off + 1 + x * 4;
      const columnaBase = Math.round((x / (w - 1)) * 40);
      const ruido = Math.round((siguiente() - 0.5) * 20);
      const v = Math.max(0, Math.min(255, 180 + filaBase - columnaBase + ruido));
      raw[p] = v; raw[p + 1] = v; raw[p + 2] = v; raw[p + 3] = 255;
    }
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
 * PDF con un AcroForm de dos páginas:
 *
 * - Página 0 (fase 1, SIN TOCAR: los tests de fase 1 indexan esta página):
 *   dos campos de texto ('nombre' vacío, 'ciudad' con valor inicial 'Lima') y
 *   una casilla ('acepto') sin marcar.
 * - Página 1 (fase 2): un grupo de radio ('color': rojo/verde/azul, sin
 *   selección inicial), un combo ('pais': Perú/Chile/México, valor inicial
 *   Chile) y una lista de selección múltiple ('frutas': manzana/pera/uva, sin
 *   selección inicial) — ejercita listFormFields/setFormChoice/setFormRadio.
 *
 * Con apariencias generadas en ambos casos.
 */
async function pdfFormulario() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const form = doc.getForm();

  const p0 = doc.addPage([320, 260]);
  p0.drawText('Formulario de prueba', { x: 20, y: 220, size: 16, font: bold });

  p0.drawText('Nombre', { x: 20, y: 185, size: 10, font });
  const nombre = form.createTextField('nombre');
  nombre.addToPage(p0, { x: 20, y: 160, width: 260, height: 20 });

  p0.drawText('Ciudad', { x: 20, y: 135, size: 10, font });
  const ciudad = form.createTextField('ciudad');
  ciudad.addToPage(p0, { x: 20, y: 110, width: 260, height: 20 });
  ciudad.setText('Lima');

  const acepto = form.createCheckBox('acepto');
  acepto.addToPage(p0, { x: 20, y: 70, width: 20, height: 20 });
  p0.drawText('Acepto los terminos', { x: 46, y: 74, size: 10, font });

  const p1 = doc.addPage([320, 300]);
  p1.drawText('Formulario de prueba (2)', { x: 20, y: 270, size: 16, font: bold });

  p1.drawText('Color', { x: 20, y: 245, size: 10, font });
  const radio = form.createRadioGroup('color');
  radio.addOptionToPage('rojo', p1, { x: 20, y: 220, width: 15, height: 15 });
  p1.drawText('Rojo', { x: 42, y: 222, size: 10, font });
  radio.addOptionToPage('verde', p1, { x: 100, y: 220, width: 15, height: 15 });
  p1.drawText('Verde', { x: 122, y: 222, size: 10, font });
  radio.addOptionToPage('azul', p1, { x: 190, y: 220, width: 15, height: 15 });
  p1.drawText('Azul', { x: 212, y: 222, size: 10, font });

  p1.drawText('Pais', { x: 20, y: 185, size: 10, font });
  const pais = form.createDropdown('pais');
  pais.addOptions(['Perú', 'Chile', 'México']);
  pais.select('Chile');
  pais.addToPage(p1, { x: 20, y: 160, width: 150, height: 20 });

  p1.drawText('Frutas', { x: 20, y: 135, size: 10, font });
  const frutas = form.createOptionList('frutas');
  frutas.addOptions(['manzana', 'pera', 'uva']);
  frutas.enableMultiselect();
  frutas.addToPage(p1, { x: 20, y: 55, width: 150, height: 70 });

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

/**
 * Construye un árbol de marcadores (outline) de bajo nivel en `doc` y lo
 * registra en el catálogo. pdf-lib no tiene API de alto nivel para esto: hay
 * que armar a mano los diccionarios /Outlines, /First, /Last, /Next, /Prev,
 * /Parent, /Title (`PDFHexString.fromText`) y /Dest (`[pageRef /Fit]`).
 *
 * `nodos`: array de `{ titulo, pagina, hijos? }`, incluido `pdfOutlineCiclo`
 * NO la usa: ese fixture necesita un /Next que apunte hacia atrás a propósito
 * (un ciclo), que esta función por construcción no puede producir.
 */
function construirOutline(doc, nodos) {
  const { context, catalog } = doc;
  const dest = (page) => context.obj([page.ref, PDFName.of('Fit')]);

  function construirNivel(lista, parentRef) {
    const refs = lista.map(() => context.nextRef());
    lista.forEach((nodo, i) => {
      const obj = { Title: PDFHexString.fromText(nodo.titulo), Parent: parentRef };
      if (i > 0) obj.Prev = refs[i - 1];
      if (i < lista.length - 1) obj.Next = refs[i + 1];
      if (nodo.pagina) obj.Dest = dest(nodo.pagina);
      if (nodo.hijos?.length) {
        const hijosRefs = construirNivel(nodo.hijos, refs[i]);
        obj.First = hijosRefs[0];
        obj.Last = hijosRefs[hijosRefs.length - 1];
        obj.Count = nodo.hijos.length;
      }
      context.assign(refs[i], context.obj(obj));
    });
    return refs;
  }

  const rootRef = context.nextRef();
  const refsNivel = construirNivel(nodos, rootRef);
  context.assign(rootRef, context.obj({
    Type: 'Outlines', First: refsNivel[0], Last: refsNivel[refsNivel.length - 1], Count: nodos.length
  }));
  catalog.set(PDFName.of('Outlines'), rootRef);
}

/**
 * PDF de 3 páginas con un árbol de marcadores (outline) de dos niveles:
 * "Capítulo 1" (página 1) con un hijo "Sección 1.1" (página 2), y
 * "Capítulo 2 — Ñandú" (página 3, con Ñ y raya para probar el UTF-16 del
 * título).
 */
async function pdfMarcadores() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p1 = doc.addPage([595.28, 841.89]);
  p1.drawText('Pagina 1', { x: 60, y: 760, size: 20, font });
  const p2 = doc.addPage([595.28, 841.89]);
  p2.drawText('Pagina 2', { x: 60, y: 760, size: 20, font });
  const p3 = doc.addPage([595.28, 841.89]);
  p3.drawText('Pagina 3', { x: 60, y: 760, size: 20, font });

  construirOutline(doc, [
    { titulo: 'Capítulo 1', pagina: p1, hijos: [{ titulo: 'Sección 1.1', pagina: p2 }] },
    { titulo: 'Capítulo 2 — Ñandú', pagina: p3 }
  ]);

  return doc.save();
}

/** Texto único de cada página de `paginas-pequenas.pdf` / `*-marcadores.pdf`. */
export const TEXTOS_PAGINAS_PEQUENAS = ['PAGINA-1', 'PAGINA-2', 'PAGINA-3', 'PAGINA-4'];

/**
 * 4 páginas pequeñas (200×120 pt) que caben TODAS a la vez en el viewport del
 * proyecto `next` (1440×900, ver playwright.config.js): abrir este documento
 * no requiere scroll para ver cualquiera de sus páginas.
 *
 * Fija E-032 (docs/ERRORES-CONOCIDOS.md): `goToPage()` dependía de que el
 * `IntersectionObserver` del visor reaccionara a un scroll real para
 * actualizar `currentPage`. Si el destino ya estaba visible (como aquí, con
 * las 4 páginas a la vez), el scroll no se movía, el observer nunca disparaba
 * y `currentPage` se quedaba con el valor anterior — clic en la miniatura 3 y
 * "Eliminar página" borraba la 1. Cada página lleva un texto único
 * ("PAGINA-1".."PAGINA-4") para poder comprobar, tras borrar, cuál sigue
 * existiendo en la capa de texto y cuál no.
 */
async function pdfPaginasPequenas() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const texto of TEXTOS_PAGINAS_PEQUENAS) {
    const p = doc.addPage([200, 120]);
    p.drawText(texto, { x: 20, y: 60, size: 14, font });
  }
  return doc.save();
}

/**
 * Nº de páginas de `grande.pdf` — usado también por los tests que lo abren,
 * para no repetir el número mágico.
 */
export const PAGINAS_GRANDE = 500;

/**
 * Documento A4 de 500 páginas, cada una con texto único ("Página N" + dos
 * líneas de relleno), para medir y arreglar el rendimiento con documentos
 * grandes (E-043 y siguientes, docs/ERRORES-CONOCIDOS.md): todas las fixtures
 * anteriores tenían 1-4 páginas, muy por debajo de un contrato o manual real
 * (300-1000 páginas). Reutiliza la MISMA fuente estándar embebida
 * (`StandardFonts.Helvetica`, embebida UNA vez por `doc.embedFont`, no una
 * por página) para que el fichero no pese de más — pdf-lib comparte el
 * objeto de fuente entre `drawText` de todas las páginas.
 */
async function pdfGrande() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= PAGINAS_GRANDE; i++) {
    const p = doc.addPage([595.28, 841.89]);
    p.drawText(`Pagina ${i}`, { x: 60, y: 780, size: 20, font });
    p.drawText(`Linea de contenido A de la pagina ${i}.`, { x: 60, y: 740, size: 12, font });
    p.drawText(`Linea de contenido B de la pagina ${i}.`, { x: 60, y: 720, size: 12, font });
  }
  return doc.save();
}

/** Texto único de cada página de `tamanos-mixtos.pdf` (E-065). */
export const TEXTOS_TAMANOS_MIXTOS = ['P1', 'P2', 'P3', 'P4'];

/**
 * 4 páginas de tamaños MUY distintos (A4 vertical, apaisada, diminuta, A4): el scroll
 * y el "más visible" del IntersectionObserver ya no coinciden con el índice esperado.
 * Fija E-065: tras Subir/Bajar/arrastrar la página actual tiene que seguir a la movida.
 */
async function pdfTamanosMixtos() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const tamanos = [[595.28, 841.89], [842, 400], [200, 120], [595.28, 841.89]];
  tamanos.forEach(([w, h], i) => {
    const p = doc.addPage([w, h]);
    p.drawText(TEXTOS_TAMANOS_MIXTOS[i], { x: 20, y: h / 2, size: 14, font });
  });
  return doc.save();
}

/**
 * Una página con líneas pegadas a los bordes (E-066): el tirador de mover (-9 px fuera de la caja)
 * de la línea de la esquina superior izquierda y de la del borde inferior caerían fuera de la página.
 */
async function pdfLineasBorde() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([400, 300]);
  p.drawText('ESQUINA', { x: 1, y: 300 - 11, size: 10, font });
  p.drawText('SUELO', { x: 1, y: 1, size: 10, font });
  p.drawText('CENTRO', { x: 150, y: 150, size: 10, font });
  return doc.save();
}

/** Igual que `paginas-pequenas.pdf`, con un marcador por página (E-032, caso (c) de pagina-actual.spec.ts). */
async function pdfPaginasPequenasMarcadores() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const paginas = TEXTOS_PAGINAS_PEQUENAS.map((texto) => {
    const p = doc.addPage([200, 120]);
    p.drawText(texto, { x: 20, y: 60, size: 14, font });
    return p;
  });
  construirOutline(doc, paginas.map((pagina, i) => ({ titulo: `Marcador ${i + 1}`, pagina })));
  return doc.save();
}

/**
 * Outline hostil para el test de seguridad del recorrido: el /Next del
 * segundo nodo apunta de vuelta al primero, formando un ciclo entre
 * hermanos. Sin protección, seguir /NextSibling entraría en bucle infinito.
 */
async function pdfOutlineCiclo() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p1 = doc.addPage([320, 200]);
  p1.drawText('Pagina 1', { x: 40, y: 150, size: 14, font });
  const p2 = doc.addPage([320, 200]);
  p2.drawText('Pagina 2', { x: 40, y: 150, size: 14, font });

  const { context, catalog } = doc;
  const dest = (page) => context.obj([page.ref, PDFName.of('Fit')]);

  const rootRef = context.nextRef();
  const nodoARef = context.nextRef();
  const nodoBRef = context.nextRef();

  context.assign(rootRef, context.obj({ Type: 'Outlines', First: nodoARef, Last: nodoBRef, Count: 2 }));
  context.assign(nodoARef, context.obj({ Title: PDFHexString.fromText('Nodo A'), Parent: rootRef, Next: nodoBRef, Dest: dest(p1) }));
  // Hostil: el segundo nodo, en vez de terminar la lista, vuelve a apuntar al primero.
  context.assign(nodoBRef, context.obj({ Title: PDFHexString.fromText('Nodo B'), Parent: rootRef, Next: nodoARef, Dest: dest(p2) }));

  catalog.set(PDFName.of('Outlines'), rootRef);

  return doc.save();
}

/** Texto de la línea vectorial de `escaneado.pdf`. El E2E de filtros/comprimir la usa para comprobar que el texto queda intacto (no forma parte de la imagen). */
export const LINEA_ESCANEADO = 'Linea vectorial de referencia';

/**
 * Página con una imagen fotográfica grande (~2000×2800 px, ~300 dpi) más una
 * línea de texto vectorial encima. Para el E2E de filtros/compresión (lote
 * E, §9 #25 y #29): la app nueva actúa solo sobre el objeto imagen —
 * `LINEA_ESCANEADO` debe seguir en la capa de texto, intacta, después de
 * filtrar o comprimir, y la zona de la imagen debe reflejar el filtro
 * aplicado.
 */
async function pdfEscaneado() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const anchoPx = 2000, altoPx = 2800, dpi = 300;
  const anchoPt = (anchoPx / dpi) * 72;
  const altoPt = (altoPx / dpi) * 72;
  const p = doc.addPage([anchoPt, altoPt]);
  const png = await doc.embedPng(pngEscaneado(anchoPx, altoPx));
  p.drawImage(png, { x: 0, y: 0, width: anchoPt, height: altoPt });
  p.drawText(LINEA_ESCANEADO, { x: 40, y: altoPt - 40, size: 14, font, color: rgb(0, 0, 0) });
  return doc.save();
}

/**
 * PDF con estructura variada para el lote F (§9 #27/#31: "Texto…" y
 * "Exportar Markdown"): un título grande en negrita, un párrafo de cuerpo de
 * dos líneas, una línea con viñeta y una línea con caracteres que Markdown
 * interpretaría como marcado (para el test de escape). Segunda página con
 * una sola línea, para comprobar el separador entre páginas.
 */
export const TITULO_ESTRUCTURADO = 'Informe anual';
export const LINEAS_CUERPO_ESTRUCTURADO = [
  'Este parrafo tiene dos lineas de cuerpo normal',
  'para poner a prueba el agrupamiento en parrafos.'
];
export const LINEA_VINETA_ESTRUCTURADO = 'punto uno';
export const LINEA_ESCAPE_ESTRUCTURADO = 'precio *especial*_2';
export const PAGINA_DOS_ESTRUCTURADO = 'Página dos';

async function pdfEstructurado() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const p1 = doc.addPage([595.28, 841.89]);
  p1.drawText(TITULO_ESTRUCTURADO, { x: 60, y: 760, size: 24, font: bold });
  LINEAS_CUERPO_ESTRUCTURADO.forEach((l, i) => p1.drawText(l, { x: 60, y: 710 - i * 16, size: 11, font }));
  p1.drawText(`• ${LINEA_VINETA_ESTRUCTURADO}`, { x: 60, y: 660, size: 11, font });
  p1.drawText(LINEA_ESCAPE_ESTRUCTURADO, { x: 60, y: 640, size: 11, font });

  const p2 = doc.addPage([595.28, 841.89]);
  p2.drawText(PAGINA_DOS_ESTRUCTURADO, { x: 60, y: 760, size: 11, font });

  return doc.save();
}

// ---------------------------------------------------------------------------
// Fixtures .docx (§9 fila #4): ZIP mínimo escrito a mano (directorio central
// + cabeceras locales), sin ninguna librería de ZIP/DOCX — igual disciplina
// que `src/convert/docx/zip.ts`, que es justamente lo que estos fixtures
// ejercitan. `metodo: 0` (stored) para los documentos normales; `metodo: 8`
// (deflate, vía `zlib.deflateRawSync`) solo para la entrada hostil.
// ---------------------------------------------------------------------------

/** Construye un ZIP (Buffer) a partir de `[{ nombre, datos, metodo? }]`. Mismo formato mínimo que `src/convert/docx/zip.ts` sabe leer. */
function construirZip(entradas) {
  const partesLocal = [];
  const partesCentral = [];
  let offset = 0;

  for (const e of entradas) {
    const metodo = e.metodo ?? 0;
    const nombreBuf = Buffer.from(e.nombre, 'utf-8');
    const original = Buffer.isBuffer(e.datos) ? e.datos : Buffer.from(e.datos);
    const comprimido = metodo === 8 ? zlib.deflateRawSync(original) : original;
    const crc = crc32(original);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(metodo, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comprimido.length, 18);
    local.writeUInt32LE(original.length, 22);
    local.writeUInt16LE(nombreBuf.length, 26);
    local.writeUInt16LE(0, 28);
    const localOffset = offset;
    partesLocal.push(local, nombreBuf, comprimido);
    offset += local.length + nombreBuf.length + comprimido.length;

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(metodo, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comprimido.length, 20);
    central.writeUInt32LE(original.length, 24);
    central.writeUInt16LE(nombreBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(localOffset, 42);
    partesCentral.push(central, nombreBuf);
  }

  const local = Buffer.concat(partesLocal);
  const central = Buffer.concat(partesCentral);
  const offsetCD = local.length;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entradas.length, 8);
  eocd.writeUInt16LE(entradas.length, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(offsetCD, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([local, central, eocd]);
}

const STYLES_BASICO = `<?xml version="1.0" encoding="UTF-8"?>
<w:styles>
  <w:docDefaults><w:rPrDefault><w:rPr><w:sz w:val="22"/><w:rFonts w:ascii="Calibri"/></w:rPr></w:rPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:before="0" w:after="200"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="36"/><w:color w:val="1F3864"/></w:rPr>
  </w:style>
</w:styles>`;

const NUMBERING_BASICO = `<?xml version="1.0" encoding="UTF-8"?>
<w:numbering>
  <w:abstractNum w:abstractNumId="0">
    <w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
    <w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/><w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl>
  </w:abstractNum>
  <w:abstractNum w:abstractNumId="1">
    <w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
  </w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
  <w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`;

/** Texto de comprobación de los tests: título, párrafo con estilos mezclados y la letra ñ, listas, y la página 2 tras el salto. */
export const DOCX_TITULO = 'Título de prueba';
export const DOCX_PARRAFO_NEGRITA = 'negrita';
export const DOCX_PARRAFO_CURSIVA = 'cursiva';
export const DOCX_PARRAFO_CON_ENIE = 'con la letra ñ.';
export const DOCX_ITEMS_VINETA = ['Primer nivel uno', 'Segundo nivel (hijo)', 'Primer nivel dos'];
export const DOCX_ITEMS_NUMERADOS = ['Elemento numerado uno', 'Elemento numerado dos'];
export const DOCX_PAGINA_DOS = 'Contenido de la página dos.';

function docxBasico() {
  const documentXml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document><w:body>
  <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${DOCX_TITULO}</w:t></w:r></w:p>
  <w:p>
    <w:pPr><w:jc w:val="center"/></w:pPr>
    <w:r><w:t xml:space="preserve">Este párrafo tiene </w:t></w:r>
    <w:r><w:rPr><w:b/></w:rPr><w:t>${DOCX_PARRAFO_NEGRITA}</w:t></w:r>
    <w:r><w:t xml:space="preserve">, </w:t></w:r>
    <w:r><w:rPr><w:i/></w:rPr><w:t>${DOCX_PARRAFO_CURSIVA}</w:t></w:r>
    <w:r><w:t xml:space="preserve"> y </w:t></w:r>
    <w:r><w:rPr><w:color w:val="C00000"/></w:rPr><w:t>color</w:t></w:r>
    <w:r><w:t xml:space="preserve">, ${DOCX_PARRAFO_CON_ENIE}</w:t></w:r>
  </w:p>
  <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>${DOCX_ITEMS_VINETA[0]}</w:t></w:r></w:p>
  <w:p><w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>${DOCX_ITEMS_VINETA[1]}</w:t></w:r></w:p>
  <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>${DOCX_ITEMS_VINETA[2]}</w:t></w:r></w:p>
  <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr><w:r><w:t>${DOCX_ITEMS_NUMERADOS[0]}</w:t></w:r></w:p>
  <w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr><w:r><w:t>${DOCX_ITEMS_NUMERADOS[1]}</w:t></w:r></w:p>
  <w:p><w:r><w:br w:type="page"/></w:r></w:p>
  <w:p><w:r><w:t>${DOCX_PAGINA_DOS}</w:t></w:r></w:p>
  <w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
</w:body></w:document>`;

  return construirZip([
    { nombre: '[Content_Types].xml', datos: '<Types/>' },
    { nombre: 'word/document.xml', datos: Buffer.from(documentXml, 'utf-8') },
    { nombre: 'word/styles.xml', datos: Buffer.from(STYLES_BASICO, 'utf-8') },
    { nombre: 'word/numbering.xml', datos: Buffer.from(NUMBERING_BASICO, 'utf-8') }
  ]);
}

/** Texto de las celdas de la tabla y advertencias esperadas (tabla + imagen). Fase 2a: tabla e imagen REALES, ver `docxTablaImagen()`. */
export const DOCX_TABLA_CELDAS = ['Producto', 'Precio', 'Manzanas', '3,50'];

/** Un `<Relationship>` de imagen/hipervínculo para `word/_rels/document.xml.rels`. */
function relacion(id, tipo, target, externo) {
  return `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${tipo}" Target="${target}"${externo ? ' TargetMode="External"' : ''}/>`;
}

function relsXml(relaciones) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relaciones.join('')}</Relationships>`;
}

/** `w:drawing` inline real (`wp:inline` -> `a:blip r:embed`), tamaño en EMU (914400/pulgada). */
function drawingInline(rId, cxEmu, cyEmu) {
  return `<w:drawing><wp:inline><wp:extent cx="${cxEmu}" cy="${cyEmu}"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="${rId}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`;
}

/** Tabla real (2x2, sin bordes/sombreado — ver `docxCompleto()` para esos) + imagen inline real (PR fase 2a): reemplaza el antiguo aplanado a texto con tabulador. */
function docxTablaImagen() {
  const documentXml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document><w:body>
  <w:p><w:r><w:t>Documento con una tabla y una imagen.</w:t></w:r></w:p>
  <w:tbl>
    <w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>
    <w:tr><w:tc><w:p><w:r><w:t>${DOCX_TABLA_CELDAS[0]}</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>${DOCX_TABLA_CELDAS[1]}</w:t></w:r></w:p></w:tc></w:tr>
    <w:tr><w:tc><w:p><w:r><w:t>${DOCX_TABLA_CELDAS[2]}</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>${DOCX_TABLA_CELDAS[3]}</w:t></w:r></w:p></w:tc></w:tr>
  </w:tbl>
  <w:p><w:r>${drawingInline('rId1', 457200, 457200)}</w:r></w:p>
</w:body></w:document>`;

  return construirZip([
    { nombre: '[Content_Types].xml', datos: '<Types/>' },
    { nombre: 'word/document.xml', datos: Buffer.from(documentXml, 'utf-8') },
    { nombre: 'word/_rels/document.xml.rels', datos: Buffer.from(relsXml([relacion('rId1', 'image', 'media/image1.png', false)]), 'utf-8') },
    { nombre: 'word/media/image1.png', datos: pngSolido(16, 16, [255, 0, 0]) }
  ]);
}

/**
 * JPEG mínimo válido (16x16, azul sólido) generado UNA vez con
 * `canvas.toDataURL('image/jpeg', 0.9)` en Chromium (sin dependencias) y
 * fijado aquí en base64: el fixture es determinista en cualquier máquina.
 */
const JPEG_AZUL_16X16_B64 =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAAQABADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABgn/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCe4CqYO//Z';

/** Tamaño declarado (`wp:extent`) de la imagen de `word-jpeg.docx`: 914400x457200 EMU = 72x36 pt. */
export const DOCX_JPEG_ANCHO_PT = 72;
export const DOCX_JPEG_ALTO_PT = 36;

/** .docx con UNA imagen JPEG inline (ejercita el camino de `createImageBitmap` del navegador, que Node no tiene). */
function docxJpeg() {
  const documentXml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document><w:body>
  <w:p><w:r><w:t>Documento con una imagen JPEG.</w:t></w:r></w:p>
  <w:p><w:r>${drawingInline('rId1', 914400, 457200)}</w:r></w:p>
</w:body></w:document>`;
  return construirZip([
    { nombre: '[Content_Types].xml', datos: '<Types/>' },
    { nombre: 'word/document.xml', datos: Buffer.from(documentXml, 'utf-8') },
    { nombre: 'word/_rels/document.xml.rels', datos: Buffer.from(relsXml([relacion('rId1', 'image', 'media/image1.jpg', false)]), 'utf-8') },
    { nombre: 'word/media/image1.jpg', datos: Buffer.from(JPEG_AZUL_16X16_B64, 'base64') }
  ]);
}

/** .docx con una celda combinada verticalmente (3 filas, sombreada) junto a celdas normales (T1b). */
function docxCombinada() {
  const bordes = '<w:tblBorders>' + ['top', 'bottom', 'left', 'right', 'insideH', 'insideV']
    .map((lado) => `<w:${lado} w:val="single" w:sz="8" w:color="000000"/>`).join('') + '</w:tblBorders>';
  const fila = (a, b, pr) => `<w:tr><w:tc><w:tcPr>${pr}</w:tcPr><w:p><w:r><w:t>${a}</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>${b}</w:t></w:r></w:p></w:tc></w:tr>`;
  const documentXml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document><w:body>
  <w:tbl><w:tblPr>${bordes}</w:tblPr><w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>
    ${fila('Fusionada', 'fila uno', '<w:vMerge w:val="restart"/><w:shd w:fill="CCE5FF"/>')}
    ${fila('', 'fila dos', '<w:vMerge/>')}
    ${fila('', 'fila tres', '<w:vMerge/>')}
    ${fila('Suelta', 'fila cuatro', '')}
  </w:tbl>
</w:body></w:document>`;
  return construirZip([
    { nombre: '[Content_Types].xml', datos: '<Types/>' },
    { nombre: 'word/document.xml', datos: Buffer.from(documentXml, 'utf-8') }
  ]);
}

/**
 * Fixture "completo" de la fase 2a (spec, ítem 8): tabla 3×3 con encabezado,
 * una celda combinada horizontalmente (`w:gridSpan`) y sombreada (`w:shd`),
 * una imagen PNG inline (reutiliza el mismo rojo sólido que `rojo.png`), un
 * hipervínculo válido y uno con esquema `javascript:` que debe acabar SIN
 * enlace y con advertencia visible.
 */
export const DOCX_COMPLETO_ENCABEZADO_COMBINADO = 'Encabezado combinado';
export const DOCX_COMPLETO_CELDAS_FILA1 = ['A1', 'B1', 'C1'];
export const DOCX_COMPLETO_CELDAS_FILA2 = ['A2', 'B2', 'C2'];
export const DOCX_COMPLETO_TEXTO_ENLACE_OK = 'Ir a example.com';
export const DOCX_COMPLETO_URL_OK = 'https://example.com';
export const DOCX_COMPLETO_TEXTO_ENLACE_JS = 'enlace peligroso';
export const DOCX_COMPLETO_URL_JS = 'javascript:alert(1)';

function docxCompleto() {
  const bordes = '<w:tblBorders>' + ['top', 'bottom', 'left', 'right', 'insideH', 'insideV']
    .map((lado) => `<w:${lado} w:val="single" w:sz="8" w:color="000000"/>`).join('') + '</w:tblBorders>';
  const documentXml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document><w:body>
  <w:p><w:r><w:t>Documento completo: tabla, imagen y enlaces.</w:t></w:r></w:p>
  <w:tbl>
    <w:tblPr>${bordes}</w:tblPr>
    <w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid>
    <w:tr><w:trPr><w:tblHeader/></w:trPr>
      <w:tc><w:tcPr><w:gridSpan w:val="2"/><w:shd w:fill="FFCC00"/></w:tcPr><w:p><w:r><w:t>${DOCX_COMPLETO_ENCABEZADO_COMBINADO}</w:t></w:r></w:p></w:tc>
      <w:tc><w:p><w:r><w:t>Col C</w:t></w:r></w:p></w:tc>
    </w:tr>
    <w:tr>
      <w:tc><w:p><w:r><w:t>${DOCX_COMPLETO_CELDAS_FILA1[0]}</w:t></w:r></w:p></w:tc>
      <w:tc><w:p><w:r><w:t>${DOCX_COMPLETO_CELDAS_FILA1[1]}</w:t></w:r></w:p></w:tc>
      <w:tc><w:p><w:r><w:t>${DOCX_COMPLETO_CELDAS_FILA1[2]}</w:t></w:r></w:p></w:tc>
    </w:tr>
    <w:tr>
      <w:tc><w:p><w:r><w:t>${DOCX_COMPLETO_CELDAS_FILA2[0]}</w:t></w:r></w:p></w:tc>
      <w:tc><w:p><w:r><w:t>${DOCX_COMPLETO_CELDAS_FILA2[1]}</w:t></w:r></w:p></w:tc>
      <w:tc><w:p><w:r><w:t>${DOCX_COMPLETO_CELDAS_FILA2[2]}</w:t></w:r></w:p></w:tc>
    </w:tr>
  </w:tbl>
  <w:p><w:r>${drawingInline('rIdImg', 457200, 457200)}</w:r></w:p>
  <w:p><w:hyperlink r:id="rIdOk"><w:r><w:t>${DOCX_COMPLETO_TEXTO_ENLACE_OK}</w:t></w:r></w:hyperlink></w:p>
  <w:p><w:hyperlink r:id="rIdJs"><w:r><w:t>${DOCX_COMPLETO_TEXTO_ENLACE_JS}</w:t></w:r></w:hyperlink></w:p>
</w:body></w:document>`;

  return construirZip([
    { nombre: '[Content_Types].xml', datos: '<Types/>' },
    { nombre: 'word/document.xml', datos: Buffer.from(documentXml, 'utf-8') },
    {
      nombre: 'word/_rels/document.xml.rels',
      datos: Buffer.from(relsXml([
        relacion('rIdImg', 'image', 'media/image1.png', false),
        relacion('rIdOk', 'hyperlink', DOCX_COMPLETO_URL_OK, true),
        relacion('rIdJs', 'hyperlink', DOCX_COMPLETO_URL_JS, true)
      ]), 'utf-8')
    },
    { nombre: 'word/media/image1.png', datos: pngSolido(16, 16, [255, 0, 0]) }
  ]);
}

/**
 * Fixture de la fase 2b (encabezados y pies): 3 páginas Carta con encabezado `first` (portada) distinto del `default`
 * (`w:titlePg`), pie "Página X de Y" con PAGE (w:fldSimple) y NUMPAGES (w:fldChar/w:instrText) en TODAS las páginas, un
 * título (Heading1) que sin `keepNext` caería solo al pie de la página 1 (52 líneas de 12 pt = 624 pt de 648 útiles; el
 * título mide ~21 pt: cabe, pero su párrafo siguiente no), y una tabla con bordes POR CELDA (`w:tcBorders`, sin
 * `w:tblBorders`). El título y su párrafo deben acabar JUNTOS en la página 2.
 */
export const DOCX_ENC_PORTADA = 'Encabezado de portada';
export const DOCX_ENC_GENERAL = 'Encabezado general';
export const DOCX_ENC_TITULO = 'Resultados del informe';
export const DOCX_ENC_TEXTO_TRAS_TITULO = 'Texto que acompaña al título.';
export const DOCX_ENC_CELDAS = ['Celda A1', 'Celda B1', 'Celda A2', 'Celda B2'];
export const DOCX_ENC_PAGINA_TRES = 'Contenido de la página tres.';
/** Líneas de relleno de la página 1. */
export const DOCX_ENC_RELLENO = 52;

function docxEncabezados() {
  const sz = '<w:rPr><w:sz w:val="20"/></w:rPr>';
  const linea = (t) => `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="exact"/></w:pPr><w:r>${sz}<w:t>${t}</w:t></w:r></w:p>`;
  const relleno = Array.from({ length: DOCX_ENC_RELLENO }, (_v, i) => linea(`Línea de relleno ${i + 1}`)).join('');
  const celda = (t, bordes) => `<w:tc><w:tcPr>${bordes}</w:tcPr><w:p><w:r>${sz}<w:t>${t}</w:t></w:r></w:p></w:tc>`;
  const rojo = ['top', 'bottom', 'left', 'right'].map((l) => `<w:${l} w:val="single" w:sz="24" w:color="C00000"/>`).join('');
  const azulAbajo = '<w:bottom w:val="single" w:sz="16" w:color="1F3864"/>';
  const documentXml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document><w:body>
  ${relleno}
  <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>${DOCX_ENC_TITULO}</w:t></w:r></w:p>
  <w:p><w:r><w:t>${DOCX_ENC_TEXTO_TRAS_TITULO}</w:t></w:r></w:p>
  <w:tbl>
    <w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="3000"/></w:tblGrid>
    <w:tr>${celda(DOCX_ENC_CELDAS[0], `<w:tcBorders>${rojo}</w:tcBorders>`)}${celda(DOCX_ENC_CELDAS[1], `<w:tcBorders>${azulAbajo}</w:tcBorders>`)}</w:tr>
    <w:tr>${celda(DOCX_ENC_CELDAS[2], '')}${celda(DOCX_ENC_CELDAS[3], `<w:tcBorders>${azulAbajo}</w:tcBorders>`)}</w:tr>
  </w:tbl>
  <w:p><w:pPr><w:pageBreakBefore/></w:pPr><w:r><w:t>${DOCX_ENC_PAGINA_TRES}</w:t></w:r></w:p>
  <w:sectPr>
    <w:headerReference w:type="default" r:id="rIdH1"/><w:headerReference w:type="first" r:id="rIdH2"/>
    <w:footerReference w:type="default" r:id="rIdF1"/><w:footerReference w:type="first" r:id="rIdF1"/>
    <w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/><w:titlePg/>
  </w:sectPr>
</w:body></w:document>`;
  const cab = (t) => `<?xml version="1.0" encoding="UTF-8"?><w:hdr><w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="20"/></w:rPr><w:t>${t}</w:t></w:r></w:p></w:hdr>`;
  const pie = `<?xml version="1.0" encoding="UTF-8"?><w:ftr><w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="0" w:after="0"/></w:pPr>
    <w:r>${sz}<w:t xml:space="preserve">Página </w:t></w:r>
    <w:fldSimple w:instr=" PAGE \\* MERGEFORMAT "><w:r>${sz}<w:t>1</w:t></w:r></w:fldSimple>
    <w:r>${sz}<w:t xml:space="preserve"> de </w:t></w:r>
    <w:r>${sz}<w:fldChar w:fldCharType="begin"/></w:r><w:r>${sz}<w:instrText xml:space="preserve"> NUMPAGES </w:instrText></w:r><w:r>${sz}<w:fldChar w:fldCharType="separate"/></w:r><w:r>${sz}<w:t>1</w:t></w:r><w:r>${sz}<w:fldChar w:fldCharType="end"/></w:r>
  </w:p></w:ftr>`;
  return construirZip([
    { nombre: '[Content_Types].xml', datos: '<Types/>' },
    { nombre: 'word/document.xml', datos: Buffer.from(documentXml, 'utf-8') },
    { nombre: 'word/styles.xml', datos: Buffer.from(STYLES_BASICO, 'utf-8') },
    { nombre: 'word/_rels/document.xml.rels', datos: Buffer.from(relsXml([relacion('rIdH1', 'header', 'header1.xml', false), relacion('rIdH2', 'header', 'header2.xml', false), relacion('rIdF1', 'footer', 'footer1.xml', false)]), 'utf-8') },
    { nombre: 'word/header1.xml', datos: Buffer.from(cab(DOCX_ENC_GENERAL), 'utf-8') },
    { nombre: 'word/header2.xml', datos: Buffer.from(cab(DOCX_ENC_PORTADA), 'utf-8') },
    { nombre: 'word/footer1.xml', datos: Buffer.from(pie, 'utf-8') }
  ]);
}

/** `w:drawing` flotante (`wp:anchor`), sin ajuste de texto real: posición en EMU respecto a la PÁGINA. */
function drawingAncla(rId, cxEmu, cyEmu, offHEmu, offVEmu) {
  return `<w:drawing><wp:anchor behindDoc="0"><wp:positionH relativeFrom="page"><wp:posOffset>${offHEmu}</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>${offVEmu}</wp:posOffset></wp:positionV><wp:extent cx="${cxEmu}" cy="${cyEmu}"/><wp:wrapSquare wrapText="bothSides"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="${rId}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing>`;
}

/** Posición y tamaño de la imagen flotante de `word-flotante.docx`, en pt: 72 pt desde la izquierda y 144 pt desde arriba de la página Carta, 72x72 pt. */
export const DOCX_FLOTANTE = { xPt: 72, desdeArribaPt: 144, wPt: 72, hPt: 72 };
export const DOCX_FLOTANTE_TEXTO = 'Texto del párrafo que ancla la imagen flotante.';

/** Un .docx con UNA imagen flotante posicionada respecto a la página (el texto no la rodea). */
function docxFlotante() {
  const documentXml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document><w:body>
  <w:p><w:r>${drawingAncla('rId1', 914400, 914400, 914400, 1828800)}<w:t>${DOCX_FLOTANTE_TEXTO}</w:t></w:r></w:p>
  <w:p><w:r><w:t>Segundo párrafo, sin nada especial.</w:t></w:r></w:p>
  <w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
</w:body></w:document>`;
  return construirZip([
    { nombre: '[Content_Types].xml', datos: '<Types/>' },
    { nombre: 'word/document.xml', datos: Buffer.from(documentXml, 'utf-8') },
    { nombre: 'word/_rels/document.xml.rels', datos: Buffer.from(relsXml([relacion('rId1', 'image', 'media/image1.png', false)]), 'utf-8') },
    { nombre: 'word/media/image1.png', datos: pngSolido(16, 16, [255, 0, 0]) }
  ]);
}

/**
 * "Zip bomb" real: 8 MB de ceros comprimidos con deflate (que reduce a un
 * puñado de KB) en una única entrada — ejercita la defensa de ratio de
 * compresión de `src/convert/docx/zip.ts` con datos reales, no solo tamaños
 * declarados falseados (eso ya lo cubre `tests/unit/docx-zip.test.ts`).
 */
function docxHostil() {
  const ceros = Buffer.alloc(8 * 1024 * 1024);
  return construirZip([{ nombre: 'word/document.xml', datos: ceros, metodo: 8 }]);
}

/**
 * PDF de 2 páginas con marcadores planos: "Capítulo" (destino página 1) y
 * "Web" con una acción en vez de destino. `accion` es el diccionario /A del
 * segundo marcador (URI, Launch, JavaScript…): para probar que el editor
 * conserva una URI y se niega a reescribir lo que no sabe conservar.
 */
async function pdfMarcadoresConAccion(accion) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p1 = doc.addPage([595.28, 841.89]);
  p1.drawText('Pagina 1', { x: 60, y: 760, size: 20, font });
  doc.addPage([595.28, 841.89]).drawText('Pagina 2', { x: 60, y: 760, size: 20, font });
  const { context, catalog } = doc;
  const root = context.nextRef(), a = context.nextRef(), b = context.nextRef();
  context.assign(a, context.obj({ Title: PDFHexString.fromText('Capítulo'), Parent: root, Next: b, Dest: context.obj([p1.ref, PDFName.of('Fit')]) }));
  context.assign(b, context.obj({ Title: PDFHexString.fromText('Web'), Parent: root, Prev: a, A: context.obj(accion) }));
  context.assign(root, context.obj({ Type: 'Outlines', First: a, Last: b, Count: 2 }));
  catalog.set(PDFName.of('Outlines'), root);
  return doc.save();
}

/**
 * A4 vertical (595.28x841.89 pt SIN girar) con tres páginas: /Rotate 90, 270 y
 * 180 (E-053). En cada una el texto "ESQUINA-SUP-IZQ" queda derecho en la
 * esquina superior-izquierda VISUAL (línea base en visual x=40 pt, y=60 pt
 * medido desde arriba). Las coordenadas de usuario se deducen de la rotación:
 *   90 : x_usuario = vy,      y_usuario = vx,      giro del texto  90
 *   270: x_usuario = W - vy,  y_usuario = H - vx,  giro del texto -90
 *   180: x_usuario = W - vx,  y_usuario = vy,      giro del texto 180
 */
async function pdfRotada() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const W = 595.28, H = 841.89, vx = 40, vy = 60; // pt de usuario / pt visuales
  const casos = [
    { rot: 90, x: vy, y: vx, giro: 90 },
    { rot: 270, x: W - vy, y: H - vx, giro: -90 },
    { rot: 180, x: W - vx, y: vy, giro: 180 }
  ];
  for (const c of casos) {
    const p = doc.addPage([W, H]);
    p.setRotation(degrees(c.rot));
    p.drawText('ESQUINA-SUP-IZQ', { x: c.x, y: c.y, size: 24, font, rotate: degrees(c.giro) });
  }
  return doc.save();
}

/**
 * E-063: tres páginas A4 con /Rotate 90, 270 y 180 y CUATRO líneas "LINEA-k-ROTADA" de texto NORMAL (sin
 * contragirar: el texto queda vertical en 90/270 y boca abajo en 180). Es el caso real de "rotar páginas" en
 * un editor (`rotada.pdf`, en cambio, contragira el texto para que quede horizontal).
 * Coordenadas en pt de usuario (origen abajo-izq, sin girar).
 */
async function pdfRotadaLineas() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const W = 595.28, H = 841.89;
  for (const rot of [90, 270, 180]) {
    const p = doc.addPage([W, H]);
    p.setRotation(degrees(rot));
    for (let k = 1; k <= 4; k++) {
      p.drawText(`LINEA-${k}-ROTADA`, { x: 80, y: H - 100 - 32 * (k - 1), size: 24, font });
    }
  }
  return doc.save();
}

/* ───────────────────────────── N1 · F0: fixtures de línea editable ───────────────────────────── */

/** Escapa un carácter latino-1 para una cadena literal PDF `( … )`. */
function cadenaPdf(ch) {
  const c = ch.charCodeAt(0);
  if (ch === '(' || ch === ')' || ch === '\\') return `\\${ch}`;
  return c < 32 || c > 126 ? `\\${c.toString(8).padStart(3, '0')}` : ch;
}

/**
 * Escribe UN `Tj` por glifo como hace Chrome/Skia: `/F tf Tf 1 0 0 -1 x y Tm` y, tras cada glifo, `dx 0 Td` con el
 * avance natural. Unidades: px CSS (la CTM de página, `0.75 0 0 -0.75 0 H cm`, las pasa a pt PDF); `y` es la línea base
 * en px con el eje Y hacia ABAJO. `extraTrasEspacio` (px) añade hueco tras cada espacio (justificación); `kern` (px)
 * ajusta el avance del primer glifo (par con kerning que Chrome parte en dos `Tj`). Devuelve el fragmento de content
 * stream y la x (px) donde acaba.
 */
function fragmentoPorGlifo({ fuente, clave, tf, x, y, texto, extraTrasEspacio = 0, color = '0 g', matriz, kern }) {
  const Tm = matriz ?? `1 0 0 -1 ${x} ${y}`;
  const partes = [`${color}\nBT /${clave} ${tf} Tf ${Tm} Tm`];
  let xFin = x;
  [...texto].forEach((ch, i) => {
    partes.push(`(${cadenaPdf(ch)}) Tj`);
    let avance = fuente.widthOfTextAtSize(ch, tf);
    xFin += avance;
    if (i < texto.length - 1) {
      if (ch === ' ') { avance += extraTrasEspacio; xFin += extraTrasEspacio; }
      if (kern !== undefined && i === 0) { avance += kern; xFin += kern; }
      partes.push(`${avance.toFixed(4)} 0 Td`);
    }
  });
  partes.push('ET');
  return { cs: partes.join('\n'), xFin };
}

/** Líneas editables esperadas en la página 1 de `por-glifo.pdf`, en orden de content stream. */
export const LINEAS_POR_GLIFO = [
  'Tabla de cifras',
  'Columna izquierda uno', 'Columna izquierda dos', 'Columna derecha uno', 'Columna derecha dos',
  'Bloque amplio izquierdo', 'Bloque amplio derecho',
  'Estilo mixto: normal NEGRITA y fin.',
  'uno dos tres cuatro cinco seis',
  'E=mc2 fin.',
  'Celda A1', 'Celda B1', 'Celda C1', 'Celda A2', 'Celda B2', 'Celda C2',
  'Texto girado',
  'Texto con recorte activo',
  'Capa OCR invisible',
  'Texto NEGRITA final'
];

/**
 * `por-glifo.pdf` (N1): imita lo que escribe Chrome (`page.pdf()`), sin depender de las fuentes del sistema.
 * Helvetica y Helvetica-Bold estándar, CTM `0.75 0 0 -0.75 0 H cm` (tamaño nominal 14,66 → efectivo 11 pt) y un `Tj`
 * por glifo. Contenido, en ORDEN de content stream (el orden importa para la agrupación):
 *  1 título con par de kerning partido en dos `Tj`; 2-5 dos columnas a 3 mm (2 filas, una columna entera tras la otra);
 *  6-7 dos bloques a 12 mm; 8 línea multiestilo (normal + negrita roja + normal); 9 línea justificada;
 *  10 superíndice; 11-16 tabla de 2 filas × 3 celdas; 17 línea girada 90°; 18 línea recortada (`re W n`);
 *  19 capa invisible (`3 Tr`); 20 línea con la negrita escrita fuera de orden.
 * Página 2 con /Rotate 90. Líneas editables esperadas: ver `LINEAS_POR_GLIFO`.
 */
async function pdfPorGlifo() {
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const TF = 14.66, TF_TIT = 29.33, TF_SUP = 9.77;
  const MM3 = 11.34, MM12 = 45.35; // 3 mm y 12 mm en px CSS
  const H = 841.89;
  const H1 = { fuente: helv, clave: 'F1' }, B1 = { fuente: bold, clave: 'F2' };
  const cs = [];

  // 1) Título: «T» + kerning −0,06 em + el resto glifo a glifo.
  cs.push(fragmentoPorGlifo({ ...B1, tf: TF_TIT, x: 48, y: 80, texto: 'Tabla de cifras', kern: -0.06 * TF_TIT }).cs);

  // 2-5) Dos columnas a 3 mm: primero la columna izquierda entera y después la derecha.
  const izq = ['Columna izquierda uno', 'Columna izquierda dos'];
  const der = ['Columna derecha uno', 'Columna derecha dos'];
  const ys = [130, 152];
  const finIzq = izq.map((t, i) => {
    const f = fragmentoPorGlifo({ ...H1, tf: TF, x: 48, y: ys[i], texto: t });
    cs.push(f.cs);
    return f.xFin;
  });
  der.forEach((t, i) => cs.push(fragmentoPorGlifo({ ...H1, tf: TF, x: finIzq[i] + MM3, y: ys[i], texto: t }).cs));

  // 6-7) Dos bloques a 12 mm, misma línea base.
  const bi = fragmentoPorGlifo({ ...H1, tf: TF, x: 48, y: 200, texto: 'Bloque amplio izquierdo' });
  cs.push(bi.cs);
  cs.push(fragmentoPorGlifo({ ...H1, tf: TF, x: bi.xFin + MM12, y: 200, texto: 'Bloque amplio derecho' }).cs);

  // 8) Multiestilo: normal + negrita roja + normal (un BT por fragmento, como Chrome).
  const m1 = fragmentoPorGlifo({ ...H1, tf: TF, x: 48, y: 250, texto: 'Estilo mixto: normal ' });
  const m2 = fragmentoPorGlifo({ ...B1, tf: TF, x: m1.xFin, y: 250, texto: 'NEGRITA', color: '1 0 0 rg' });
  const m3 = fragmentoPorGlifo({ ...H1, tf: TF, x: m2.xFin, y: 250, texto: ' y fin.', color: '0 g' });
  cs.push(m1.cs, m2.cs, m3.cs);

  // 9) Justificada: 5 px de hueco extra tras cada espacio.
  cs.push(fragmentoPorGlifo({ ...H1, tf: TF, x: 48, y: 280, texto: 'uno dos tres cuatro cinco seis', extraTrasEspacio: 5 }).cs);

  // 10) Superíndice: «E=mc» + «2» pequeño y elevado 6 px + « fin.» en la línea base.
  const s1 = fragmentoPorGlifo({ ...H1, tf: TF, x: 48, y: 310, texto: 'E=mc' });
  const s2 = fragmentoPorGlifo({ ...H1, tf: TF_SUP, x: s1.xFin, y: 304, texto: '2' });
  const s3 = fragmentoPorGlifo({ ...H1, tf: TF, x: s2.xFin, y: 310, texto: ' fin.' });
  cs.push(s1.cs, s2.cs, s3.cs);

  // 11-16) Tabla 2 × 3, celdas con 2 mm de relleno (hueco ≈ 0,78 em), por filas.
  for (const [fila, y] of [['1', 350], ['2', 372]]) {
    let x = 48;
    for (const col of ['A', 'B', 'C']) {
      const f = fragmentoPorGlifo({ ...H1, tf: TF, x, y, texto: `Celda ${col}${fila}` });
      cs.push(f.cs);
      x = f.xFin + MM3;
    }
  }

  // 17) Línea girada 90° (sube): Tm = [0 -1 -1 0 x y] en el espacio CSS con Y hacia abajo.
  cs.push(fragmentoPorGlifo({ ...H1, tf: TF, x: 700, y: 520, texto: 'Texto girado', matriz: '0 -1 -1 0 700 520' }).cs);

  // 18) Línea recortada: el clip rectangular contiene el texto (el objeto lleva clip propio).
  cs.push(`q 40 398 260 28 re W n\n${fragmentoPorGlifo({ ...H1, tf: TF, x: 48, y: 420, texto: 'Texto con recorte activo' }).cs}\nQ`);

  // 19) Capa invisible (modo de render 3), como un OCR.
  cs.push(`q 3 Tr\n${fragmentoPorGlifo({ ...H1, tf: TF, x: 48, y: 450, texto: 'Capa OCR invisible' }).cs}\nQ`);

  // 20) Negrita escrita fuera de orden: primero «Texto » y « final», al final «NEGRITA».
  const f1 = fragmentoPorGlifo({ ...H1, tf: TF, x: 48, y: 480, texto: 'Texto ' });
  const fb = fragmentoPorGlifo({ ...B1, tf: TF, x: f1.xFin, y: 480, texto: 'NEGRITA' });
  const f3 = fragmentoPorGlifo({ ...H1, tf: TF, x: fb.xFin, y: 480, texto: ' final' });
  cs.push(f1.cs, f3.cs, fb.cs);

  const montar = (page, contenido) => {
    page.node.setFontDictionary(PDFName.of('F1'), helv.ref);
    page.node.setFontDictionary(PDFName.of('F2'), bold.ref);
    const stream = doc.context.stream(`q 0.75 0 0 -0.75 0 ${H} cm\n${contenido}\nQ`);
    page.node.set(PDFName.of('Contents'), doc.context.register(stream));
  };
  montar(doc.addPage([595.28, H]), cs.join('\n'));

  // Página 2 con /Rotate 90: mismas técnicas, pocas líneas.
  const p2 = doc.addPage([595.28, H]);
  p2.setRotation(degrees(90));
  montar(p2, [
    fragmentoPorGlifo({ ...B1, tf: TF_TIT, x: 48, y: 80, texto: 'Pagina girada' }).cs,
    fragmentoPorGlifo({ ...H1, tf: TF, x: 48, y: 130, texto: 'Linea uno de la pagina girada' }).cs
  ].join('\n'));
  return doc.save({ useObjectStreams: false });
}

/**
 * Glifos de la TrueType SINTÉTICA del subconjunto CID (1000 unidades por em): 0 `.notdef`, 1 espacio, 2 H, 3 O, 4 L,
 * 5 A, 6 M, 7 U, 8 N, 9 D. Cualquier otro carácter NO existe en el subconjunto.
 */
const GLIFOS_CID = [
  { gid: 0, ch: null, adv: 500 }, { gid: 1, ch: ' ', adv: 300 },
  { gid: 2, ch: 'H', adv: 700 }, { gid: 3, ch: 'O', adv: 750 }, { gid: 4, ch: 'L', adv: 550 },
  { gid: 5, ch: 'A', adv: 700 }, { gid: 6, ch: 'M', adv: 850 }, { gid: 7, ch: 'U', adv: 700 },
  { gid: 8, ch: 'N', adv: 750 }, { gid: 9, ch: 'D', adv: 750 }
];

/**
 * Una TrueType mínima construida a mano tabla a tabla (rectángulos): no se versiona ningún binario ni hay licencia de
 * fuente. Tablas: OS/2, cmap (formato 4), glyf, head, hhea, hmtx, loca (largo), maxp, name, post (v3).
 */
function ttfSintetica() {
  const u16 = (v) => { const b = Buffer.alloc(2); b.writeUInt16BE(v & 0xffff); return b; };
  const i16 = (v) => { const b = Buffer.alloc(2); b.writeInt16BE(v); return b; };
  const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32BE(v >>> 0); return b; };
  const pad4 = (b) => (b.length % 4 === 0 ? b : Buffer.concat([b, Buffer.alloc(4 - (b.length % 4))]));
  // glyf: un contorno de 4 puntos en curva (rectángulo x 50…adv-50, y 0…700); el espacio no tiene contornos.
  const glifos = GLIFOS_CID.map((g) => {
    if (g.gid === 1) return Buffer.alloc(0);
    const x0 = 50, x1 = g.adv - 50, y0 = 0, y1 = 700;
    return pad4(Buffer.concat([
      i16(1), i16(x0), i16(y0), i16(x1), i16(y1), // numberOfContours + bbox
      u16(3), u16(0), // endPtsOfContours[0] = 3, instructionLength = 0
      Buffer.from([1, 1, 1, 1]), // flags: en curva, coordenadas int16
      i16(x0), i16(x1 - x0), i16(0), i16(x0 - x1), // x relativas
      i16(y0), i16(0), i16(y1 - y0), i16(0) // y relativas
    ]));
  });
  const offs = [0];
  for (const g of glifos) offs.push(offs[offs.length - 1] + g.length);
  const n = GLIFOS_CID.length;
  const head = Buffer.concat([
    u32(0x00010000), u32(0x00010000), u32(0), u32(0x5f0f3cf5), u16(0), u16(1000),
    Buffer.alloc(16), // created + modified
    i16(0), i16(0), i16(900), i16(700), u16(0), u16(8), i16(2), i16(1), i16(0)
  ]);
  const hhea = Buffer.concat([
    u32(0x00010000), i16(800), i16(-200), i16(0), u16(850), i16(0), i16(0), i16(900),
    i16(1), i16(0), i16(0), Buffer.alloc(8), i16(0), u16(n)
  ]);
  const maxp = Buffer.concat([u32(0x00010000), u16(n), u16(4), u16(1), u16(0), u16(0), u16(2), ...Array(8).fill(u16(0))]);
  const hmtx = Buffer.concat(GLIFOS_CID.flatMap((g) => [u16(g.adv), i16(g.gid === 1 ? 0 : 50)]));
  const loca = Buffer.concat(offs.map((o) => u32(o)));
  // cmap formato 4: un segmento por carácter + el terminador 0xFFFF.
  const mapeados = GLIFOS_CID.filter((g) => g.ch).sort((a, b) => a.ch.charCodeAt(0) - b.ch.charCodeAt(0));
  const segs = mapeados.length + 1;
  const codigos = [...mapeados.map((g) => g.ch.charCodeAt(0)), 0xffff];
  const fmt4 = Buffer.concat([
    u16(4), u16(16 + segs * 8), u16(0), u16(segs * 2), u16(0), u16(0), u16(0),
    Buffer.concat(codigos.map((c) => u16(c))), u16(0), Buffer.concat(codigos.map((c) => u16(c))),
    Buffer.concat([...mapeados.map((g) => i16(g.gid - g.ch.charCodeAt(0))), i16(1)]),
    Buffer.alloc(segs * 2)
  ]);
  const cmap = Buffer.concat([u16(0), u16(1), u16(3), u16(1), u32(12), fmt4]);
  const post = Buffer.concat([u32(0x00030000), u32(0), i16(-100), i16(50), u32(0), Buffer.alloc(16)]);
  const nombre = Buffer.from('SinteticaSub', 'utf16le').swap16();
  const name = Buffer.concat([u16(0), u16(1), u16(18), u16(3), u16(1), u16(0x409), u16(4), u16(nombre.length), u16(0), nombre]);
  const os2 = Buffer.concat([
    u16(1), i16(550), u16(400), u16(5), u16(0), ...Array(8).fill(i16(0)), i16(0), i16(0), i16(0), // v1 hasta sFamilyClass
    Buffer.alloc(10), u32(1), u32(0), u32(0), u32(0), Buffer.from('NONE'), // panose, rangos Unicode, vendor
    u16(0x40), u16(0x20), u16(0x7a), i16(800), i16(-200), i16(0), u16(900), u16(200), u32(1), u32(0)
  ]);
  const tablas = { 'OS/2': os2, cmap, glyf: Buffer.concat(glifos), head, hhea, hmtx, loca, maxp, name, post };
  const etiquetas = Object.keys(tablas).sort();
  const nt = etiquetas.length;
  const cabecera = Buffer.concat([u32(0x00010000), u16(nt), u16(128), u16(3), u16(nt * 16 - 128)]);
  let off = 12 + nt * 16;
  const dir = [], datos = [];
  const suma = (b) => { const p = pad4(b); let s = 0; for (let i = 0; i < p.length; i += 4) s = (s + p.readUInt32BE(i)) >>> 0; return s; };
  for (const t of etiquetas) {
    const b = tablas[t];
    dir.push(Buffer.concat([Buffer.from(t, 'latin1'), u32(suma(b)), u32(off), u32(b.length)]));
    datos.push(pad4(b));
    off += pad4(b).length;
  }
  return Buffer.concat([cabecera, ...dir, ...datos]);
}

/** Textos de `cid-subconjunto.pdf`: cada línea es UN solo `Tj`. */
export const TEXTO_CID = ['HOLA MUNDO', 'UNA MANO'];

/**
 * `cid-subconjunto.pdf` (N1): la TrueType sintética incrustada como SUBCONJUNTO CID (Type0 / CIDFontType2, Identity-H +
 * /ToUnicode), como la que escriben Chrome, Skia o LibreOffice, con solo 10 glifos. Dos líneas, un `Tj` cada una:
 * «HOLA MUNDO» y «UNA MANO». Cualquier carácter fuera de H O L A M U N D y el espacio (p. ej. «€», «Q», «Z») no está en
 * el subconjunto, aunque `FPDFFont_GetGlyphPath` diga que sí (E-079).
 */
async function pdfCidSubconjunto() {
  const doc = await PDFDocument.create();
  const ctx = doc.context;
  const ttf = ttfSintetica();
  const fontFile = ctx.register(ctx.flateStream(ttf, { Length1: ttf.length }));
  const nombre = 'AAAAAA+SinteticaSub';
  const descriptor = ctx.register(ctx.obj({
    Type: 'FontDescriptor', FontName: nombre, Flags: 4, FontBBox: [0, 0, 900, 700], ItalicAngle: 0,
    Ascent: 800, Descent: -200, CapHeight: 700, StemV: 80, FontFile2: fontFile
  }));
  const cid = ctx.register(ctx.obj({
    Type: 'Font', Subtype: 'CIDFontType2', BaseFont: nombre,
    CIDSystemInfo: { Registry: PDFString.of('Adobe'), Ordering: PDFString.of('Identity'), Supplement: 0 },
    FontDescriptor: descriptor, DW: 1000, W: [0, GLIFOS_CID.map((g) => g.adv)], CIDToGIDMap: 'Identity'
  }));
  const hex4 = (v) => v.toString(16).toUpperCase().padStart(4, '0');
  const bf = GLIFOS_CID.filter((g) => g.ch).map((g) => `<${hex4(g.gid)}> <${hex4(g.ch.charCodeAt(0))}>`);
  const cmapUni = [
    '/CIDInit /ProcSet findresource begin 12 dict begin begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def /CMapType 2 def',
    '1 begincodespacerange <0000> <FFFF> endcodespacerange',
    `${bf.length} beginbfchar`, ...bf, 'endbfchar', 'endcmap CMapName currentdict /CMap defineresource pop end end'
  ].join('\n');
  const toUni = ctx.register(ctx.flateStream(Buffer.from(cmapUni, 'latin1')));
  const font = ctx.register(ctx.obj({
    Type: 'Font', Subtype: 'Type0', BaseFont: nombre, Encoding: 'Identity-H', DescendantFonts: [cid], ToUnicode: toUni
  }));
  const codigos = (t) => `<${[...t].map((c) => hex4(GLIFOS_CID.find((g) => g.ch === c).gid)).join('')}>`;
  const page = doc.addPage([320, 200]);
  page.node.setFontDictionary(PDFName.of('F1'), font);
  const cuerpo = `BT /F1 24 Tf 40 130 Td ${codigos(TEXTO_CID[0])} Tj ET\nBT /F1 24 Tf 40 80 Td ${codigos(TEXTO_CID[1])} Tj ET`;
  page.node.set(PDFName.of('Contents'), ctx.register(ctx.stream(cuerpo)));
  return doc.save({ useObjectStreams: false });
}

/**
 * `justificado-tw.pdf` (E-085): líneas justificadas como las de InDesign y Word. Cada línea son DOS objetos de texto que
 * parten la palabra «cooperativa» («coop» | «erativa»). El segundo empieza donde acaba DE VERDAD el primero, pero el
 * avance NATURAL de los glifos no lo sabe:
 *   1. `Tw` de 9 pt con 4 espacios: el real es 36 pt (3 em) mayor que el natural.
 *   2. `TJ` con tres ajustes de +250 (apretar): el real es 9 pt (0,75 em) MENOR que el natural.
 * Helvetica estándar, 12 pt, a 72 pt del borde izquierdo.
 */
export const TEXTO_JUSTIFICADO = [
  { a: 'Los clientes de la coop', b: 'erativa trabajan bien', y: 700 },
  { a: 'Nuestros clientes acuerdan que la coop', b: 'erativa decide hoy', y: 640 }
];
async function pdfJustificadoTw() {
  const doc = await PDFDocument.create();
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const ancho = (t) => helv.widthOfTextAtSize(t, 12);
  const page = doc.addPage([420, 780]);
  page.node.setFontDictionary(PDFName.of('F1'), helv.ref);
  const num = (v) => v.toFixed(4).replace(/\.?0+$/, '');
  const L1 = TEXTO_JUSTIFICADO[0];
  const x1 = 72 + ancho(L1.a) + 4 * 9; // 4 espacios con Tw = 9
  const L2 = TEXTO_JUSTIFICADO[1];
  const tramos = ['Nuestros', ' clientes', ' acuerdan que la', ' coop'];
  const x2 = 72 + ancho(L2.a) - 3 * 0.25 * 12; // tres ajustes de +250 milésimas de em
  const cuerpo = [
    `BT /F1 12 Tf 9 Tw 72 ${L1.y} Td (${L1.a}) Tj ET`,
    `BT /F1 12 Tf 9 Tw 1 0 0 1 ${num(x1)} ${L1.y} Tm (${L1.b}) Tj ET`,
    `BT /F1 12 Tf 0 Tw 72 ${L2.y} Td [(${tramos[0]}) 250 (${tramos[1]}) 250 (${tramos[2]}) 250 (${tramos[3]})] TJ ET`,
    `BT /F1 12 Tf 0 Tw 1 0 0 1 ${num(x2)} ${L2.y} Tm (${L2.b}) Tj ET`
  ].join('\n');
  page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.stream(cuerpo)));
  return doc.save({ useObjectStreams: false });
}

/**
 * E-084: tres páginas cuya caja VISIBLE no tiene origen (0,0), como las plantillas de Acrobat Distiller.
 *   1: MediaBox [0 0 595.28 841.89] y CropBox [36 36 436 336] (400x300 visibles, origen (36,36)).
 *   2: MediaBox [-50 -80 350 220] (origen negativo, 400x300), sin CropBox.
 *   3: CropBox [36 36 336 436] (300x400 visibles) con /Rotate 90 y el texto SIN contragirar.
 * Todo en pt de usuario (origen abajo-izq, sin girar). Las líneas "CROPBOX-<p>-<k>" caen dentro de la caja visible.
 */
async function pdfCropboxDesplazado() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p1 = doc.addPage([595.28, 841.89]);
  p1.setCropBox(36, 36, 400, 300);
  p1.drawText('CROPBOX-1-A', { x: 60, y: 290, size: 24, font });
  p1.drawText('CROPBOX-1-B', { x: 60, y: 200, size: 24, font });
  const p2 = doc.addPage([595.28, 841.89]);
  p2.setMediaBox(-50, -80, 400, 300);
  p2.drawText('CROPBOX-2-A', { x: -20, y: 170, size: 24, font });
  p2.drawText('CROPBOX-2-B', { x: -20, y: 60, size: 24, font });
  const p3 = doc.addPage([595.28, 841.89]);
  p3.setCropBox(36, 36, 300, 400);
  p3.setRotation(degrees(90));
  p3.drawText('CROPBOX-3-A', { x: 60, y: 400, size: 24, font });
  p3.drawText('CROPBOX-3-B', { x: 60, y: 300, size: 24, font });
  return doc.save();
}

async function main() {
  fs.mkdirSync(SALIDA, { recursive: true });
  const archivos = {
    'nativo.pdf': await pdfNativo(),
    'hostil.pdf': await pdfHostil(),
    'apaisado.pdf': await pdfApaisado(),
    'rotada.pdf': await pdfRotada(),
    'rotada-lineas.pdf': await pdfRotadaLineas(),
    'cropbox-desplazado.pdf': await pdfCropboxDesplazado(),
    'fuentes.pdf': await pdfFuentes(),
    'formulario.pdf': await pdfFormulario(),
    'subconjunto.pdf': await pdfSubconjunto(),
    'por-glifo.pdf': await pdfPorGlifo(),
    'cid-subconjunto.pdf': await pdfCidSubconjunto(),
    'justificado-tw.pdf': await pdfJustificadoTw(),
    'marcadores.pdf': await pdfMarcadores(),
    'outline-ciclo.pdf': await pdfOutlineCiclo(),
    'marcadores-uri.pdf': await pdfMarcadoresConAccion({ S: 'URI', URI: PDFString.of('https://example.com/') }),
    'marcadores-launch.pdf': await pdfMarcadoresConAccion({ S: 'Launch', F: PDFString.of('calc.exe') }),
    'marcadores-js.pdf': await pdfMarcadoresConAccion({ S: 'JavaScript', JS: PDFString.of('app.alert(1)') }),
    'paginas-pequenas.pdf': await pdfPaginasPequenas(),
    'grande.pdf': await pdfGrande(),
    'tamanos-mixtos.pdf': await pdfTamanosMixtos(),
    'lineas-borde.pdf': await pdfLineasBorde(),
    'paginas-pequenas-marcadores.pdf': await pdfPaginasPequenasMarcadores(),
    'escaneado.pdf': await pdfEscaneado(),
    'estructurado.pdf': await pdfEstructurado(),
    'rojo.png': pngSolido(16, 16, [255, 0, 0]),
    'firma-blanca.png': pngFirma(120, 60),
    'word-basico.docx': docxBasico(),
    'word-tabla-imagen.docx': docxTablaImagen(),
    'word-completo.docx': docxCompleto(),
    'word-jpeg.docx': docxJpeg(),
    'word-combinada.docx': docxCombinada(),
    'word-encabezados.docx': docxEncabezados(),
    'word-flotante.docx': docxFlotante(),
    'word-hostil.docx': docxHostil()
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
