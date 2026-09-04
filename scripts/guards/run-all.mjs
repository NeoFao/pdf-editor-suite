#!/usr/bin/env node
/**
 * Ejecuta todas las reglas deterministas y devuelve 1 si alguna falla.
 *
 *   npm run guard            # todas
 *   npm run guard -- <id>    # solo una, útil al iterar
 *
 * Estas reglas corren en el pre-commit y en CI. No se saltan con --no-verify:
 * el mismo script vuelve a correr en el PR.
 */
import { TODAS } from './reglas.mjs';
import { reportar, deuda } from './lib.mjs';

const filtro = process.argv[2];
const reglas = filtro ? TODAS.filter((r) => r.id === filtro) : TODAS;

if (reglas.length === 0) {
  console.error(`No existe la regla "${filtro}". Disponibles:\n  ${TODAS.map((r) => r.id).join('\n  ')}`);
  process.exit(2);
}

console.log(`Reglas deterministas (${reglas.length}):\n`);

let fallos = 0;
for (const regla of reglas) {
  try {
    fallos += reportar(regla.id, regla.titulo, regla.ejecutar(), regla.comoArreglar);
  } catch (err) {
    console.error(`\nERROR  ${regla.id} lanzó una excepción: ${err.message}`);
    fallos++;
  }
}

// La deuda declarada se imprime SIEMPRE, aunque todo esté en verde: una
// excepción silenciosa se vuelve permanente en tres semanas.
const pendiente = deuda().entradas;
if (pendiente.length > 0) {
  console.log(`
Deuda técnica declarada (${pendiente.length}/${deuda().maximo_entradas}):`);
  for (const e of pendiente) {
    console.log(`  · ${e.ruta}  [${e.reglas.join(', ')}]`);
    console.log(`      ${e.resolucion}`);
  }
  console.log('  Detalle y reglas de este fichero: scripts/guards/deuda-tecnica.json');
}

if (fallos > 0) {
  console.error(`\n${fallos} regla(s) en rojo. El cambio no puede entrar así.`);
  console.error('Contexto de cada regla: docs/ERRORES-CONOCIDOS.md\n');
  process.exit(1);
}

console.log('\nTodas las reglas en verde.');
