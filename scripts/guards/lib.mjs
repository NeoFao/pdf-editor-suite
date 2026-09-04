import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Marca que desactiva una regla en la línea siguiente. Exige una razón. */
export const ESCAPE = /guard-disable-next-line\s+([a-z-]+)\s*:\s*(.+)/;

export function leer(rel) {
  return fs.readFileSync(path.join(RAIZ, rel), 'utf8');
}

export function existe(rel) {
  return fs.existsSync(path.join(RAIZ, rel));
}

/** Ficheros de la app que las reglas analizan (no node_modules, no vendor). */
export function fuentesApp() {
  const salida = [];
  const ignorar = new Set(['node_modules', '.git', 'dist', 'playwright-report', 'test-results', 'generados']);
  const vendor = /^js\/(pdf\.min\.js|pdf\.worker\.min\.js)$/;

  (function recorrer(dir) {
    for (const entrada of fs.readdirSync(path.join(RAIZ, dir), { withFileTypes: true })) {
      const rel = dir ? `${dir}/${entrada.name}` : entrada.name;
      if (ignorar.has(entrada.name)) continue;
      if (entrada.isDirectory()) recorrer(rel);
      else if (entrada.name.endsWith('.js') && !vendor.test(rel)) salida.push(rel);
    }
  })('js');

  return salida;
}

/**
 * Devuelve el conjunto de líneas (1-indexed) precedidas por un escape válido.
 * Un escape sin razón no vale: obliga a escribir por qué.
 */
export function lineasExentas(contenido, idRegla) {
  const exentas = new Set();
  contenido.split('\n').forEach((linea, i) => {
    const m = linea.match(ESCAPE);
    if (m && m[1] === idRegla && m[2].trim().length >= 10) exentas.add(i + 2);
  });
  return exentas;
}

/**
 * Deuda técnica reconocida: excepciones temporales, visibles y acotadas.
 * No es una lista de exclusión silenciosa — `run-all.mjs` la imprime siempre.
 */
export function deuda() {
  const ruta = path.join(RAIZ, 'scripts/guards/deuda-tecnica.json');
  if (!fs.existsSync(ruta)) return { maximo_entradas: 0, entradas: [] };
  return JSON.parse(fs.readFileSync(ruta, 'utf8'));
}

/** ¿Está `archivo` exento de `idRegla` por deuda declarada? */
export function tieneDeuda(archivo, idRegla) {
  return deuda().entradas.some(
    (e) => e.ruta === archivo && e.reglas.includes(idRegla) && e.motivo && e.resolucion
  );
}

/** Resultado uniforme para que run-all.mjs pueda agregarlos. */
export function hallazgo(archivo, linea, mensaje) {
  return { archivo, linea, mensaje };
}

export function reportar(idRegla, titulo, hallazgos, comoArreglar) {
  if (hallazgos.length === 0) {
    console.log(`  OK  ${idRegla}  ${titulo}`);
    return 0;
  }
  console.error(`\nFALLO  ${idRegla}  ${titulo}`);
  for (const h of hallazgos) {
    console.error(`  ${h.archivo}${h.linea ? `:${h.linea}` : ''}  ${h.mensaje}`);
  }
  console.error(`\n  Cómo arreglarlo: ${comoArreglar}`);
  console.error(`  Escape (solo con razón real): // guard-disable-next-line ${idRegla}: <por qué>\n`);
  return 1;
}
