import { DocxError } from './DocxError';

/**
 * Tokenizador y parser de XML mínimo y PURO, escrito a mano (§9 fila #4).
 * Deliberadamente NO usa `DOMParser`: no existe en Node (donde corren los
 * tests unitarios y donde correrá el futuro conversor de escritorio), y
 * escribirlo a mano es lo que permite controlar la seguridad por
 * CONSTRUCCIÓN en vez de confiar en las opciones de un parser ajeno.
 *
 * SEGURIDAD (entrada no confiable, AGENTS.md §2):
 * - **XXE imposible por construcción.** Cualquier `<!DOCTYPE` en el
 *   documento lo rechaza de inmediato, ANTES de tokenizar nada — ni se
 *   intenta entender su subconjunto interno. Esto también neutraliza
 *   "billion laughs" (que necesita `<!DOCTYPE ... [ <!ENTITY ...> ... ]>`
 *   para declarar las entidades que se anidan): sin DOCTYPE no hay dónde
 *   declarar una entidad propia.
 * - Solo se expanden las 5 entidades predefinidas de XML (`&amp; &lt; &gt;
 *   &quot; &apos;`) y las referencias de carácter numéricas (`&#123;`,
 *   `&#x7B;`). Cualquier otra entidad (`&algo;`) es un error: sin DOCTYPE no
 *   hay forma legítima de que exista.
 * - Límite de profundidad de anidamiento (`MAX_PROFUNDIDAD`): una entrada
 *   con decenas de miles de elementos anidados se rechaza enseguida, antes
 *   de construir un árbol gigante.
 * - Límite de tamaño de entrada (`MAX_TEXTO_CHARS`) y de número total de
 *   nodos (`MAX_NODOS`): defensa en profundidad además de los límites que ya
 *   impone `zip.ts` sobre el tamaño descomprimido.
 *
 * Espacios de nombres: este parser NO resuelve `xmlns:w="..."` a una URI —
 * conserva el nombre de la etiqueta TAL CUAL viene, con su prefijo
 * (`w:p`, `a:blip`...). Suficiente aquí porque Word siempre usa los mismos
 * prefijos convencionales en `word/document.xml`/`styles.xml`/
 * `numbering.xml`, y `modelo.ts` los usa literalmente.
 */

export interface XmlElemento {
  tipo: 'elemento';
  nombre: string;
  atributos: Record<string, string>;
  hijos: XmlNodo[];
}

export interface XmlTexto { tipo: 'texto'; texto: string }

export type XmlNodo = XmlElemento | XmlTexto;

const MAX_PROFUNDIDAD = 200;
const MAX_TEXTO_CHARS = 50 * 1024 * 1024;
const MAX_NODOS = 500_000;

const ESPACIO = /\s/;

export function parseXml(entrada: string): XmlElemento {
  if (entrada.length > MAX_TEXTO_CHARS) {
    throw new DocxError('El XML del documento es demasiado grande; se rechaza por seguridad.');
  }
  // Comprobación previa a tokenizar NADA: ver el comentario de módulo (XXE / billion laughs).
  if (/<!DOCTYPE/i.test(entrada)) {
    throw new DocxError('Formato no soportado: el XML declara un DOCTYPE, rechazado por seguridad.');
  }

  const texto = entrada;
  const n = texto.length;
  let i = 0;
  let nodos = 0;

  function error(mensaje: string): never {
    throw new DocxError(`XML mal formado: ${mensaje} (posición ${i}).`);
  }

  function saltarEspacios(): void {
    while (i < n && ESPACIO.test(texto[i]!)) i++;
  }

  /** Salta comentarios/instrucciones de procesamiento que puedan aparecer antes de la raíz. */
  function saltarProlog(): void {
    for (;;) {
      saltarEspacios();
      if (texto.startsWith('<?', i)) {
        const fin = texto.indexOf('?>', i);
        if (fin === -1) error('instrucción de procesamiento sin cerrar');
        i = fin + 2;
        continue;
      }
      if (texto.startsWith('<!--', i)) {
        const fin = texto.indexOf('-->', i);
        if (fin === -1) error('comentario sin cerrar');
        i = fin + 3;
        continue;
      }
      break;
    }
  }

  function contarNodo(): void {
    nodos++;
    if (nodos > MAX_NODOS) throw new DocxError('El XML tiene demasiados nodos; se rechaza por seguridad.');
  }

  /** Decodifica entidades en un tramo de texto/atributo YA extraído (sin `<`). Rechaza cualquier entidad no reconocida. */
  function decodificarEntidades(s: string): string {
    let out = '';
    let pos = 0;
    for (;;) {
      const amp = s.indexOf('&', pos);
      if (amp === -1) { out += s.slice(pos); break; }
      out += s.slice(pos, amp);
      const semi = s.indexOf(';', amp);
      if (semi === -1 || semi - amp > 12) error('referencia de entidad sin cerrar, o demasiado larga');
      const ent = s.slice(amp + 1, semi);
      if (ent === 'amp') out += '&';
      else if (ent === 'lt') out += '<';
      else if (ent === 'gt') out += '>';
      else if (ent === 'quot') out += '"';
      else if (ent === 'apos') out += "'";
      else if (ent[0] === '#') {
        const hex = ent[1] === 'x' || ent[1] === 'X';
        const cp = hex ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
        if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) error('referencia de carácter numérica inválida');
        out += String.fromCodePoint(cp);
      } else {
        error(`entidad no reconocida "&${ent};" (sin DOCTYPE no hay entidades propias válidas)`);
      }
      pos = semi + 1;
    }
    return out;
  }

  function parseElemento(profundidad: number): XmlElemento {
    if (profundidad > MAX_PROFUNDIDAD) throw new DocxError('El XML está anidado demasiado profundo; se rechaza por seguridad.');
    if (texto[i] !== '<') error('se esperaba "<"');
    i++;
    const inicioNombre = i;
    while (i < n && !ESPACIO.test(texto[i]!) && texto[i] !== '/' && texto[i] !== '>') i++;
    const nombre = texto.slice(inicioNombre, i);
    if (nombre === '') error('nombre de elemento vacío');

    const atributos: Record<string, string> = {};
    for (;;) {
      saltarEspacios();
      if (i >= n) error(`etiqueta "${nombre}" sin cerrar`);
      if (texto[i] === '/' && texto[i + 1] === '>') {
        i += 2;
        contarNodo();
        return { tipo: 'elemento', nombre, atributos, hijos: [] };
      }
      if (texto[i] === '>') { i++; break; }

      const inicioAttr = i;
      while (i < n && !ESPACIO.test(texto[i]!) && texto[i] !== '=' && texto[i] !== '/' && texto[i] !== '>') i++;
      const nombreAttr = texto.slice(inicioAttr, i);
      if (nombreAttr === '') error('atributo mal formado');
      saltarEspacios();
      if (texto[i] !== '=') error('se esperaba "=" tras el nombre del atributo');
      i++;
      saltarEspacios();
      const comilla = texto[i];
      if (comilla !== '"' && comilla !== "'") error('valor de atributo sin comillas');
      i++;
      const finValor = texto.indexOf(comilla, i);
      if (finValor === -1) error('valor de atributo sin cerrar');
      const valorCrudo = texto.slice(i, finValor);
      i = finValor + 1;
      atributos[nombreAttr] = decodificarEntidades(valorCrudo);
    }

    contarNodo();
    const hijos: XmlNodo[] = [];
    for (;;) {
      if (i >= n) error(`elemento "${nombre}" sin cerrar`);
      if (texto[i] === '<') {
        if (texto.startsWith('<!--', i)) {
          const fin = texto.indexOf('-->', i);
          if (fin === -1) error('comentario sin cerrar');
          i = fin + 3;
          continue;
        }
        if (texto.startsWith('<![CDATA[', i)) {
          const fin = texto.indexOf(']]>', i);
          if (fin === -1) error('sección CDATA sin cerrar');
          hijos.push({ tipo: 'texto', texto: texto.slice(i + 9, fin) });
          i = fin + 3;
          continue;
        }
        if (texto.startsWith('<?', i)) {
          const fin = texto.indexOf('?>', i);
          if (fin === -1) error('instrucción de procesamiento sin cerrar');
          i = fin + 2;
          continue;
        }
        if (texto.startsWith('</', i)) {
          i += 2;
          const inicioCierre = i;
          while (i < n && !ESPACIO.test(texto[i]!) && texto[i] !== '>') i++;
          const nombreCierre = texto.slice(inicioCierre, i);
          saltarEspacios();
          if (texto[i] !== '>') error('etiqueta de cierre mal formada');
          i++;
          if (nombreCierre !== nombre) error(`la etiqueta de cierre "${nombreCierre}" no coincide con "${nombre}"`);
          return { tipo: 'elemento', nombre, atributos, hijos };
        }
        hijos.push(parseElemento(profundidad + 1));
        continue;
      }
      const inicioTexto = i;
      const siguiente = texto.indexOf('<', i);
      const finTexto = siguiente === -1 ? n : siguiente;
      const crudo = texto.slice(inicioTexto, finTexto);
      i = finTexto;
      if (crudo.length > 0) hijos.push({ tipo: 'texto', texto: decodificarEntidades(crudo) });
    }
  }

  saltarProlog();
  if (i >= n || texto[i] !== '<') error('documento XML vacío o sin elemento raíz');
  return parseElemento(0);
}

// --- Utilidades de acceso, para que `modelo.ts` no repita el mismo filtro por todas partes ---

export function esElemento(nodo: XmlNodo): nodo is XmlElemento { return nodo.tipo === 'elemento'; }

/** Hijos elemento directos con `nombre` (p. ej. `'w:r'`), en orden de documento. */
export function hijosElemento(el: XmlElemento, nombre: string): XmlElemento[] {
  const out: XmlElemento[] = [];
  for (const h of el.hijos) if (h.tipo === 'elemento' && h.nombre === nombre) out.push(h);
  return out;
}

/** Primer hijo elemento directo con `nombre`, o `null`. */
export function primerHijo(el: XmlElemento, nombre: string): XmlElemento | null {
  for (const h of el.hijos) if (h.tipo === 'elemento' && h.nombre === nombre) return h;
  return null;
}

/** Todo el texto (nodos `texto` directos) de `el`, concatenado en orden. No recorre subelementos. */
export function textoDirecto(el: XmlElemento): string {
  let out = '';
  for (const h of el.hijos) if (h.tipo === 'texto') out += h.texto;
  return out;
}
