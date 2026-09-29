/**
 * Iconos SVG propios de esta app (rediseño de interfaz, §4 del encargo):
 * trazos simples de 20×20, `stroke="currentColor"`, dibujados a mano para
 * este repositorio — no son copia de ningún set de terceros (Lucide,
 * Feather, etc.), así que no hace falta aviso en THIRD_PARTY_NOTICES.md.
 *
 * AGENTS.md §2.2 ("nunca innerHTML con datos del documento") se extiende
 * aquí por disciplina: aunque estas formas son fijas, se construyen con
 * `createElementNS`, igual que el resto de la app construye DOM con
 * `createElement`/`textContent` en vez de plantillas.
 */

const NS = 'http://www.w3.org/2000/svg';

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>): SVGElementTagNameMap[K] {
  const n = document.createElementNS(NS, tag) as SVGElementTagNameMap[K];
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}

/** Trazo de las formas base de cada icono, en coordenadas de un lienzo 20×20. */
type Trazo = () => SVGElement[];

const P = (d: string): SVGElement => el('path', { d });
const L = (x1: number, y1: number, x2: number, y2: number): SVGElement =>
  el('line', { x1: String(x1), y1: String(y1), x2: String(x2), y2: String(y2) });
const R = (x: number, y: number, w: number, h: number, rx = 1.5): SVGElement =>
  el('rect', { x: String(x), y: String(y), width: String(w), height: String(h), rx: String(rx) });
const C = (cx: number, cy: number, r: number): SVGElement =>
  el('circle', { cx: String(cx), cy: String(cy), r: String(r) });
const PUNTO = (cx: number, cy: number, r: number): SVGElement =>
  el('circle', { cx: String(cx), cy: String(cy), r: String(r), fill: 'currentColor', stroke: 'none' });

/** Catálogo de iconos: un nombre por control de la interfaz que los usa. */
const DIBUJOS: Record<string, Trazo> = {
  'carpeta-abrir': () => [P('M2 6.5 a1 1 0 0 1 1-1 h4 l1.6 2 H17 a1 1 0 0 1 1 1 v7.5 a1 1 0 0 1-1 1 H3 a1 1 0 0 1-1-1 Z')],
  'documento-nuevo': () => [P('M5 2.5 h7 l3 3 v12 a1 1 0 0 1-1 1 H5 a1 1 0 0 1-1-1 V3.5 a1 1 0 0 1 1-1 Z'), P('M12 2.5 V6 h3'), L(7, 12, 13, 12), L(10, 9, 10, 15)],
  guardar: () => [P('M4 3 h10 l3 3 v11 a1 1 0 0 1-1 1 H4 a1 1 0 0 1-1-1 V4 a1 1 0 0 1 1-1 Z'), P('M6.5 3 v5 h6 V3'), R(6, 12.5, 8, 4.5, 0.6)],
  imprimir: () => [R(5, 2.5, 10, 5, 0.8), R(4, 7.5, 12, 6.5, 1), R(6.5, 14.5, 7, 3.5, 0.6), C(15.3, 10, 0.9)],
  deshacer: () => [P('M8 5 L4 9 l4 4'), P('M4 9 h8 a5 5 0 0 1 0 10 h-3')],
  rehacer: () => [P('M12 5 l4 4 -4 4'), P('M16 9 H8 a5 5 0 0 0 0 10 h3')],
  'menos': () => [L(4.5, 10, 15.5, 10)],
  mas: () => [L(4.5, 10, 15.5, 10), L(10, 4.5, 10, 15.5)],
  'ajustar-ancho': () => [R(6, 4, 8, 12, 1.2), P('M2.5 10 h2.2'), P('M2.5 10 l2 -1.8 M2.5 10 l2 1.8'), P('M17.5 10 h-2.2'), P('M17.5 10 l-2 -1.8 M17.5 10 l-2 1.8')],
  buscar: () => [C(8.7, 8.7, 5.2), L(12.6, 12.6, 17, 17)],
  menu: () => [L(3, 5.5, 17, 5.5), L(3, 10, 17, 10), L(3, 14.5, 17, 14.5)],
  'mas-opciones': () => [PUNTO(4.5, 10, 1.15), PUNTO(10, 10, 1.15), PUNTO(15.5, 10, 1.15)],
  'insertar-texto': () => [L(5, 4.5, 15, 4.5), L(10, 4.5, 10, 15.5), L(7, 15.5, 13, 15.5)],
  // Revisión de PR #63: el rectángulo con las dos diagonales se leía como un
  // sobre de correo, no como "borrar/redactar". Metáfora inequívoca: dos
  // renglones de texto normales y, entre ellos, una barra MACIZA (relleno
  // sólido, no un trazo más) — el tachón opaco de una redacción.
  redactar: () => [L(4, 5.5, 16, 5.5), el('rect', { x: '4', y: '8.5', width: '12', height: '3.3', rx: '0.6', fill: 'currentColor', stroke: 'none' }), L(4, 14.5, 12, 14.5)],
  imagen: () => [R(2.5, 3.5, 15, 13, 1.4), C(7, 8, 1.6), P('M3.2 15.2 l4.6-5 3 3 2.6-3.4 3.6 4.4')],
  ocr: () => [R(3, 2.5, 14, 15, 1.4), L(6, 7, 14, 7), L(6, 10, 14, 10), L(6, 13, 11, 13), C(15.5, 14.5, 2.6), L(17.3, 16.3, 19, 18)],
  resaltar: () => [P('M11.5 3 L17 8.5 L9 16.5 H4.5 v-4.5 Z'), L(4.5, 16.5, 2, 19), L(11.5, 3, 14, 5.5)],
  subrayar: () => [P('M6.5 3.5 v6.5 a3.5 3.5 0 0 0 7 0 V3.5'), L(5, 16, 15, 16)],
  tachar: () => [P('M6.5 3.5 v3 a3.5 3.2 0 0 0 6.6 1.4'), P('M13.4 12 a3.5 3.2 0 0 1-6.9 1.6'), L(3, 9.5, 17, 9.5)],
  nota: () => [P('M3 4 h14 a1 1 0 0 1 1 1 v8 a1 1 0 0 1-1 1 H9 l-3.5 3.5 V14 H3 a1 1 0 0 1-1-1 V5 a1 1 0 0 1 1-1 Z'), L(5, 7.5, 15, 7.5), L(5, 10.2, 12, 10.2)],
  pluma: () => [P('M4 16 l1-4 9-9 3 3-9 9-4 1Z'), L(9.9, 7, 12.9, 10)],
  rectangulo: () => [R(3.5, 4.5, 13, 11, 1.4)],
  borrador: () => [el('rect', { x: '3', y: '9.5', width: '13', height: '7', rx: '1.2', transform: 'rotate(-28 10 10)' }), L(6, 16, 17, 16)],
  rotar: () => [P('M15.5 6.2 A6.8 6.8 0 1 0 16.8 11'), P('M12 3.5 l3.7 2.3 -1 4.1')],
  'eliminar-pagina': () => [L(4, 6, 16, 6), P('M7 6 V4.3 a1 1 0 0 1 1-1 h4 a1 1 0 0 1 1 1 V6'), P('M5.5 6 l0.8 10.2 a1 1 0 0 0 1 0.9 h5.4 a1 1 0 0 0 1-0.9 L14.5 6'), L(8.3, 9, 8.3, 14), L(11.7, 9, 11.7, 14)],
  duplicar: () => [R(3, 3, 11, 11, 1.2), P('M8 17 H16 a1 1 0 0 0 1-1 V8')],
  subir: () => [L(10, 15.5, 10, 4.5), P('M5.5 9 L10 4.5 14.5 9')],
  bajar: () => [L(10, 4.5, 10, 15.5), P('M5.5 11 L10 15.5 14.5 11')],
  // Revisión de PR #63: con el mismo "documento + signo +" que
  // `documento-nuevo`, los dos se confundían a 20px. Metáfora distinta:
  // una flecha entra EN una página — "insertar dentro del documento actual",
  // no "crear uno nuevo".
  'insertar-pdf': () => [R(9, 3, 8, 14, 1.4), L(1.5, 10, 6.5, 10), P('M4 7.5 L6.5 10 L4 12.5')],
  extraer: () => [P('M5 2.5 h7 l3 3 v6.2'), L(6, 17.5, 15, 17.5), L(9.2, 10, 9.2, 15.6), P('M6.7 13.4 L9.2 15.9 11.7 13.4')],
  dividir: () => [C(5, 5, 2), C(5, 15, 2), L(6.6, 6.3, 17, 17), L(6.6, 13.7, 17, 3), L(12, 10, 15, 10)],
  firmar: () => [P('M2.5 15 q2-1 3.3 0 t3.3 0 2.7-3 2-6.5 q-0.7 3 1 5 t3.7 0.5'), L(2.5, 17.3, 17, 17.3)],
  'firma-imagen': () => [R(2.5, 3.5, 15, 10.5, 1.4), C(6.7, 7.2, 1.4), P('M3.2 12.7 l4-4.3 2.6 2.6 2.2-2.8 3 3.4'), P('M12.5 15.5 l1.6-1.6 2 2-1.6 1.6-2-2Z')],
  'texto-panel': () => [P('M5 2.5 h7 l3 3 v12 a1 1 0 0 1-1 1 H5 a1 1 0 0 1-1-1 V3.5 a1 1 0 0 1 1-1 Z'), L(6.5, 9, 13.5, 9), L(6.5, 11.6, 13.5, 11.6), L(6.5, 14.2, 11, 14.2)],
  'exportar-md': () => [P('M5 2.5 h7 l3 3 v12 a1 1 0 0 1-1 1 H5 a1 1 0 0 1-1-1 V3.5 a1 1 0 0 1 1-1 Z'), P('M6.3 15 v-4.4 l1.7 2 1.7-2 V15'), L(12, 10.6, 12, 15), P('M10.4 13.4 L12 15 13.6 13.4')],
  filtro: () => [P('M3 3.5 H17 L11.5 10 v5.5 l-3 1.5 V10 Z')],
  comprimir: () => [P('M7.5 2.5 v3.6 a1.4 1.4 0 0 1-1.4 1.4 H2.5'), P('M12.5 2.5 v3.6 a1.4 1.4 0 0 0 1.4 1.4 H17.5'), P('M7.5 17.5 v-3.6 a1.4 1.4 0 0 0-1.4-1.4 H2.5'), P('M12.5 17.5 v-3.6 a1.4 1.4 0 0 1 1.4-1.4 H17.5')],
  'flecha-izq': () => [P('M12 4.5 L6 10 12 15.5')],
  'flecha-der': () => [P('M8 4.5 L14 10 8 15.5')]
};

export type NombreIcono = keyof typeof DIBUJOS;

/** Construye un `<svg>` de 20×20 para el icono `nombre`. Nunca por innerHTML — ver el comentario de cabecera. */
export function crearIcono(nombre: NombreIcono): SVGSVGElement {
  const dibujo = DIBUJOS[nombre];
  const svg = el('svg', {
    viewBox: '0 0 20 20',
    width: '20',
    height: '20',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '1.6',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
    focusable: 'false'
  });
  svg.classList.add('icono');
  for (const nodo of dibujo!()) svg.appendChild(nodo);
  return svg;
}
