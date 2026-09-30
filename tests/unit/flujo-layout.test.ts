import { test, expect } from 'vitest';
import { wrapAtoms, lineToFlowLine, paginar, type Atom, type Medir, type FlowItem, type PageGeometry } from '../../src/convert/flujo/layout';

/** medir falso EXACTO: 6pt por carácter, igual para toda fuente/tamaño — dimensiones predecibles a mano. */
const medir: Medir = (_font, _sizePt, text) => text.length * 6;

function atomo(text: string): Atom { return { text, font: 'Helvetica', sizePt: 11, color: [0, 0, 0] }; }
function atomoNegrita(text: string): Atom { return { text, font: 'Helvetica-Bold', sizePt: 11, color: [0, 0, 0] }; }
function atomoPegado(text: string): Atom { return { text, font: 'Helvetica', sizePt: 11, color: [0, 0, 0], pegado: true }; }

// E-041 (docs/ERRORES-CONOCIDOS.md): un átomo "pegado" (DOCX: una palabra y
// la coma que la sigue en dos `w:r` de formato distinto, SIN espacio real
// entre ambos) no debe llevar un espacio de más — ni cuando cae en el mismo
// trazo (mismo estilo) ni cuando cae en uno distinto (estilo distinto).
test('un átomo "pegado" del MISMO estilo se fusiona en el trazo sin espacio de unión', () => {
  const atoms = [atomo('hola'), atomoPegado(',')];
  const linea = lineToFlowLine(atoms, 0, 300, 'left', true, 14, medir);
  expect(linea.segs).toHaveLength(1);
  expect(linea.segs[0]!.text).toBe('hola,');
});

test('un átomo "pegado" de OTRO estilo queda en un trazo aparte, pero sin hueco entre los dos trazos', () => {
  const atoms = [atomoNegrita('negrita'), atomoPegado(',')];
  const linea = lineToFlowLine(atoms, 0, 300, 'left', true, 14, medir);
  expect(linea.segs).toHaveLength(2);
  expect(linea.segs[0]!.text).toBe('negrita');
  expect(linea.segs[1]!.text).toBe(',');
  // Sin espacio entre ambos: el segundo trazo empieza justo donde termina el primero.
  const finPrimero = linea.segs[0]!.xPt + medir(linea.segs[0]!.font, linea.segs[0]!.sizePt, linea.segs[0]!.text);
  expect(linea.segs[1]!.xPt).toBe(finPrimero);
});

test('wrapAtoms no reserva hueco de espacio antes de un átomo "pegado"', () => {
  const atoms = [atomo('palabra'), atomoPegado('!')];
  // Ancho justo para "palabra!" (8 chars * 6 = 48pt) pero NO para "palabra !" (9*6=54pt con espacio).
  const lineas = wrapAtoms(atoms, 48, medir);
  expect(lineas).toHaveLength(1); // cabe en una sola línea porque no se reserva el espacio
});

test('justificado: un hueco "pegado" no recibe el espacio extra repartido ni cuenta como hueco', () => {
  const atoms = [atomo('uno'), atomo('dos'), atomoPegado(',')];
  const linea = lineToFlowLine(atoms, 0, 200, 'justify', false, 14, medir);
  // Solo hay 1 hueco distribuible (entre "uno" y "dos"); el de antes de "," no cuenta.
  expect(linea.segs).toHaveLength(3);
  const finDos = linea.segs[1]!.xPt + medir('Helvetica', 11, 'dos');
  expect(linea.segs[2]!.xPt).toBe(finDos); // la coma pegada justo tras "dos", sin espacio ni extra
});

test('alineación centrada: la línea se desplaza para quedar centrada en el ancho disponible', () => {
  const atoms = [atomo('hola')]; // ancho = 4*6 = 24pt
  const linea = lineToFlowLine(atoms, 0, 100, 'center', true, 14, medir);
  // Centrado en 100pt: offset = (100-24)/2 = 38.
  expect(linea.segs[0]!.xPt).toBe(38);
});

test('alineación derecha: la línea termina pegada al borde derecho del ancho disponible', () => {
  const atoms = [atomo('hola')]; // 24pt
  const linea = lineToFlowLine(atoms, 10, 100, 'right', true, 14, medir);
  // xStart(10) + offset(100-24=76) = 86; fin de línea = 86+24 = 110 = 10+100.
  expect(linea.segs[0]!.xPt).toBe(86);
});

test('alineación izquierda: sin desplazamiento, arranca exactamente en xStart', () => {
  const atoms = [atomo('hola')];
  const linea = lineToFlowLine(atoms, 25, 200, 'left', true, 14, medir);
  expect(linea.segs[0]!.xPt).toBe(25);
});

test('justificado: reparte el espacio sobrante entre las palabras (no es la última línea)', () => {
  // 3 palabras de 4 letras = 3*24=72pt de palabras; 2 huecos normales de 6pt = 12pt; natural = 84pt.
  // Ancho disponible 120pt -> sobrante 36pt repartido en 2 huecos = 18pt extra cada uno.
  const atoms = [atomo('hola'), atomo('todo'), atomo('bien')];
  const linea = lineToFlowLine(atoms, 0, 120, 'justify', false, 14, medir);
  expect(linea.segs).toHaveLength(3);
  expect(linea.segs[0]!.xPt).toBe(0);
  // segundo empieza tras "hola"(24) + espacio normal(6) + extra(18) = 48
  expect(linea.segs[1]!.xPt).toBe(48);
});

test('justificado: la ÚLTIMA línea del párrafo NO se justifica (cae a la izquierda, fusionando palabras del mismo estilo)', () => {
  const atoms = [atomo('hola'), atomo('mundo')];
  const linea = lineToFlowLine(atoms, 5, 200, 'justify', true, 14, medir);
  // Mismo estilo -> left fusiona en un solo trazo "hola mundo", sin espacio extra repartido.
  expect(linea.segs).toHaveLength(1);
  expect(linea.segs[0]!.xPt).toBe(5);
  expect(linea.segs[0]!.text).toBe('hola mundo');
});

test('justificado con una sola palabra en la línea: no hay huecos que repartir, cae a la izquierda', () => {
  const atoms = [atomo('sola')];
  const linea = lineToFlowLine(atoms, 0, 300, 'justify', false, 14, medir);
  expect(linea.segs).toHaveLength(1);
  expect(linea.segs[0]!.xPt).toBe(0);
});

test('wrapAtoms: ajusta igual que antes (ancho fijo por carácter), sin romper el contrato', () => {
  const atoms = Array.from({ length: 5 }, () => atomo('aaaaa')); // 30pt cada una, espacio 6pt
  // 100pt de ancho: caben 2 palabras (30+6+30=66), la 3a (66+6+30=102) no cabe.
  const lineas = wrapAtoms(atoms, 100, medir);
  expect(lineas.map((l) => l.length)).toEqual([2, 2, 1]);
});

test('paginar: un salto de página explícito al PRINCIPIO del documento no genera una página en blanco de más', () => {
  const items: FlowItem[] = [
    { kind: 'pagebreak' },
    { kind: 'line', height: 14, segs: [{ xPt: 0, text: 'x', font: 'Helvetica', sizePt: 11, color: [0, 0, 0] }], bars: [] }
  ];
  const geo: PageGeometry = { widthPt: 595, heightPt: 842, marginTopPt: 56, marginBottomPt: 56, marginLeftPt: 56, marginRightPt: 56 };
  const { totalPaginas, trazos } = paginar(items, geo, 0.28);
  expect(totalPaginas).toBe(1);
  expect(trazos[0]!.page).toBe(0);
});

test('paginar: un salto de página explícito DESPUÉS de contenido mueve lo siguiente a la página 2', () => {
  const items: FlowItem[] = [
    { kind: 'line', height: 14, segs: [{ xPt: 0, text: 'pagina1', font: 'Helvetica', sizePt: 11, color: [0, 0, 0] }], bars: [] },
    { kind: 'pagebreak' },
    { kind: 'line', height: 14, segs: [{ xPt: 0, text: 'pagina2', font: 'Helvetica', sizePt: 11, color: [0, 0, 0] }], bars: [] }
  ];
  const geo: PageGeometry = { widthPt: 595, heightPt: 842, marginTopPt: 56, marginBottomPt: 56, marginLeftPt: 56, marginRightPt: 56 };
  const { totalPaginas, trazos } = paginar(items, geo, 0.28);
  expect(totalPaginas).toBe(2);
  expect(trazos.find((t) => t.text === 'pagina1')!.page).toBe(0);
  expect(trazos.find((t) => t.text === 'pagina2')!.page).toBe(1);
});

test('lineToFlowLine: un átomo con url produce un Seg con url y wPt (base del enlace clicable)', () => {
  const atoms: Atom[] = [{ text: 'clic', font: 'Helvetica', sizePt: 11, color: [0, 0, 255], url: 'https://example.com' }];
  const linea = lineToFlowLine(atoms, 0, 300, 'left', true, 14, medir);
  expect(linea.segs).toHaveLength(1);
  expect(linea.segs[0]!.url).toBe('https://example.com');
  expect(linea.segs[0]!.wPt).toBe(24); // 4 chars * 6
});

test('lineToFlowLine: dos átomos con URLs distintas NUNCA se fusionan en un solo trazo, aunque compartan estilo', () => {
  const atoms: Atom[] = [
    { text: 'uno', font: 'Helvetica', sizePt: 11, color: [0, 0, 255], url: 'https://a.example.com' },
    { text: 'dos', font: 'Helvetica', sizePt: 11, color: [0, 0, 255], url: 'https://b.example.com' }
  ];
  const linea = lineToFlowLine(atoms, 0, 300, 'left', true, 14, medir);
  expect(linea.segs).toHaveLength(2);
});

test('paginar: un enlace en una línea produce una entrada en `enlaces` con la misma página y URL', () => {
  const items: FlowItem[] = [
    { kind: 'line', height: 14, segs: [{ xPt: 10, text: 'clic', font: 'Helvetica', sizePt: 11, color: [0, 0, 255], url: 'https://example.com', wPt: 24 }], bars: [] }
  ];
  const geo: PageGeometry = { widthPt: 595, heightPt: 842, marginTopPt: 56, marginBottomPt: 56, marginLeftPt: 56, marginRightPt: 56 };
  const { enlaces } = paginar(items, geo, 0.28);
  expect(enlaces).toHaveLength(1);
  expect(enlaces[0]).toMatchObject({ page: 0, xPt: 10, url: 'https://example.com' });
});

test('paginar: un ítem `image` reserva su propia altura y aparece en `imagenes` con su id', () => {
  const items: FlowItem[] = [{ kind: 'image', height: 100, xPt: 56, wPt: 200, imgId: 'img-1' }];
  const geo: PageGeometry = { widthPt: 595, heightPt: 842, marginTopPt: 56, marginBottomPt: 56, marginLeftPt: 56, marginRightPt: 56 };
  const { imagenes, totalPaginas } = paginar(items, geo, 0.28);
  expect(totalPaginas).toBe(1);
  expect(imagenes).toEqual([{ page: 0, xPt: 56, yPt: 842 - 56 - 100, wPt: 200, hPt: 100, imgId: 'img-1' }]);
});

test('paginar: una fila de tabla que no cabe entera pasa COMPLETA a la página siguiente (nunca se corta)', () => {
  const geo: PageGeometry = { widthPt: 300, heightPt: 200, marginTopPt: 10, marginBottomPt: 10, marginLeftPt: 10, marginRightPt: 10 };
  // Área útil: 180pt de alto. Una línea de 150pt deja 30pt libres; una fila de 60pt no cabe -> pasa a la página 2 ENTERA.
  const items: FlowItem[] = [
    { kind: 'line', height: 150, segs: [{ xPt: 0, text: 'x', font: 'Helvetica', sizePt: 11, color: [0, 0, 0] }], bars: [] },
    { kind: 'tableRow', height: 60, lineas: [{ relYPt: 20, segs: [{ xPt: 10, text: 'celda', font: 'Helvetica', sizePt: 11, color: [0, 0, 0] }] }], fondos: [], bordes: [], esEncabezado: false }
  ];
  const { trazos } = paginar(items, geo, 0.28);
  const filaTrazo = trazos.find((t) => t.text === 'celda')!;
  expect(filaTrazo.page).toBe(1);
});

test('paginar: repite la(s) fila(s) de encabezado al principio de cada página nueva mientras dura la tabla', () => {
  const geo: PageGeometry = { widthPt: 300, heightPt: 150, marginTopPt: 10, marginBottomPt: 10, marginLeftPt: 10, marginRightPt: 10 };
  const encabezado: FlowItem & { kind: 'tableRow' } = {
    kind: 'tableRow', height: 20, esEncabezado: true, fondos: [], bordes: [],
    lineas: [{ relYPt: 14, segs: [{ xPt: 10, text: 'ENC', font: 'Helvetica', sizePt: 11, color: [0, 0, 0] }] }]
  };
  const filaGrande = (texto: string): FlowItem => ({
    kind: 'tableRow', height: 100, esEncabezado: false, fondos: [], bordes: [],
    lineas: [{ relYPt: 14, segs: [{ xPt: 10, text: texto, font: 'Helvetica', sizePt: 11, color: [0, 0, 0] }] }]
  });
  const items: FlowItem[] = [
    { kind: 'tableStart', headerRows: [encabezado] },
    encabezado,
    filaGrande('fila-1'),
    filaGrande('fila-2'), // área útil = 130pt: encabezado(20)+fila-1(100)=120 cabe; fila-2(100) no cabe -> salto, se repite ENC
    { kind: 'tableEnd' }
  ];
  const { trazos } = paginar(items, geo, 0.28);
  const encPorPagina = trazos.filter((t) => t.text === 'ENC').map((t) => t.page);
  expect(encPorPagina).toEqual([0, 1]); // una vez en cada página
  expect(trazos.find((t) => t.text === 'fila-1')!.page).toBe(0);
  expect(trazos.find((t) => t.text === 'fila-2')!.page).toBe(1);
});

test('paginar respeta márgenes distintos de un documento con geometría propia (no A4)', () => {
  const items: FlowItem[] = Array.from({ length: 3 }, (_v, i) => ({ kind: 'line' as const, height: 100, segs: [{ xPt: 0, text: `l${i}`, font: 'Helvetica', sizePt: 11, color: [0, 0, 0] as [number, number, number] }], bars: [] }));
  const geo: PageGeometry = { widthPt: 300, heightPt: 320, marginTopPt: 10, marginBottomPt: 10, marginLeftPt: 10, marginRightPt: 10 };
  const { totalPaginas, trazos } = paginar(items, geo, 0.28);
  // Área útil: 300pt de alto. 3 líneas de 100pt = 300pt exactos -> caben todas en 1 página.
  expect(totalPaginas).toBe(1);
  for (const t of trazos) { expect(t.yPt).toBeGreaterThanOrEqual(geo.marginBottomPt - 1); expect(t.yPt).toBeLessThanOrEqual(geo.heightPt - geo.marginTopPt); }
});
