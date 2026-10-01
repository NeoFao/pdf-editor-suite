/**
 * Genera los PDF de prueba que consume la suite E2E.
 *
 * Los fixtures NO se versionan: se regeneran de forma determinista antes de
 * cada corrida (`npm run test:fixtures`). Así el repo no acumula binarios y
 * cualquier máquina obtiene exactamente el mismo documento.
 */
import { PDFDocument, StandardFonts, rgb, PDFName, PDFHexString, PDFString } from 'pdf-lib';
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

/** Texto de las celdas de la tabla y advertencias esperadas (tabla + imagen). */
export const DOCX_TABLA_CELDAS = ['Producto', 'Precio', 'Manzanas', '3,50'];

function docxTablaImagen() {
  const documentXml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document><w:body>
  <w:p><w:r><w:t>Documento con una tabla y una imagen no soportadas en fase 1.</w:t></w:r></w:p>
  <w:tbl>
    <w:tr><w:tc><w:p><w:r><w:t>${DOCX_TABLA_CELDAS[0]}</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>${DOCX_TABLA_CELDAS[1]}</w:t></w:r></w:p></w:tc></w:tr>
    <w:tr><w:tc><w:p><w:r><w:t>${DOCX_TABLA_CELDAS[2]}</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>${DOCX_TABLA_CELDAS[3]}</w:t></w:r></w:p></w:tc></w:tr>
  </w:tbl>
  <w:p><w:r><w:drawing/></w:r></w:p>
</w:body></w:document>`;

  return construirZip([
    { nombre: '[Content_Types].xml', datos: '<Types/>' },
    { nombre: 'word/document.xml', datos: Buffer.from(documentXml, 'utf-8') }
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

async function main() {
  fs.mkdirSync(SALIDA, { recursive: true });
  const archivos = {
    'nativo.pdf': await pdfNativo(),
    'hostil.pdf': await pdfHostil(),
    'apaisado.pdf': await pdfApaisado(),
    'fuentes.pdf': await pdfFuentes(),
    'formulario.pdf': await pdfFormulario(),
    'subconjunto.pdf': await pdfSubconjunto(),
    'marcadores.pdf': await pdfMarcadores(),
    'outline-ciclo.pdf': await pdfOutlineCiclo(),
    'marcadores-uri.pdf': await pdfMarcadoresConAccion({ S: 'URI', URI: PDFString.of('https://example.com/') }),
    'marcadores-launch.pdf': await pdfMarcadoresConAccion({ S: 'Launch', F: PDFString.of('calc.exe') }),
    'marcadores-js.pdf': await pdfMarcadoresConAccion({ S: 'JavaScript', JS: PDFString.of('app.alert(1)') }),
    'paginas-pequenas.pdf': await pdfPaginasPequenas(),
    'grande.pdf': await pdfGrande(),
    'paginas-pequenas-marcadores.pdf': await pdfPaginasPequenasMarcadores(),
    'escaneado.pdf': await pdfEscaneado(),
    'estructurado.pdf': await pdfEstructurado(),
    'rojo.png': pngSolido(16, 16, [255, 0, 0]),
    'firma-blanca.png': pngFirma(120, 60),
    'word-basico.docx': docxBasico(),
    'word-tabla-imagen.docx': docxTablaImagen(),
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
