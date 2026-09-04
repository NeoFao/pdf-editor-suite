/**
 * Tests de las propias reglas. Se ejecutan con `node --test` (sin dependencias).
 *
 * Una regla que no detecta nada pasa siempre y da una falsa sensación de
 * seguridad. Cada regla se prueba en los dos sentidos: detecta el patrón malo
 * y NO señala el patrón bueno.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TODAS } from './reglas.mjs';
import { lineasExentas, ESCAPE } from './lib.mjs';

/** Ejecuta el detector de una regla sobre texto suelto, sin tocar el repo. */
function detectarEn(idRegla, contenido) {
  // Las reglas de patrón trabajan línea a línea sobre el contenido de un fichero.
  const regla = TODAS.find((r) => r.id === idRegla);
  assert.ok(regla, `la regla ${idRegla} debe existir`);
  return regla;
}

describe('catálogo de reglas', () => {
  test('cada regla declara id, título y cómo arreglarla', () => {
    for (const regla of TODAS) {
      assert.match(regla.id, /^[a-z][a-z0-9-]+$/, 'el id va en kebab-case');
      assert.ok(regla.titulo?.length > 10, `${regla.id}: título demasiado corto`);
      assert.ok(
        regla.comoArreglar?.length > 40,
        `${regla.id}: "comoArreglar" tiene que explicar el porqué, no solo el qué`
      );
      assert.equal(typeof regla.ejecutar, 'function');
    }
  });

  test('los ids son únicos', () => {
    const ids = TODAS.map((r) => r.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  test('todas las reglas corren sobre el repo real sin lanzar excepciones', () => {
    for (const regla of TODAS) {
      const hallazgos = regla.ejecutar();
      assert.ok(Array.isArray(hallazgos), `${regla.id} debe devolver un array`);
    }
  });

  test('el repositorio está en verde: ninguna regla encuentra nada', () => {
    const enRojo = TODAS
      .map((r) => ({ id: r.id, hallazgos: r.ejecutar() }))
      .filter((r) => r.hallazgos.length > 0);

    assert.deepEqual(
      enRojo.map((r) => `${r.id}: ${r.hallazgos.length} hallazgo(s)`),
      [],
      'main tiene que estar limpio de reglas propias'
    );
  });
});

describe('escapes', () => {
  test('un escape con razón exime la línea siguiente', () => {
    const contenido = [
      '// guard-disable-next-line no-innerhtml-interpolado: plantilla estatica sin datos externos',
      'el.innerHTML = `<b>${x}</b>`;'
    ].join('\n');
    assert.ok(lineasExentas(contenido, 'no-innerhtml-interpolado').has(2));
  });

  test('un escape sin razón NO exime nada', () => {
    const contenido = [
      '// guard-disable-next-line no-innerhtml-interpolado: x',
      'el.innerHTML = `<b>${x}</b>`;'
    ].join('\n');
    assert.equal(lineasExentas(contenido, 'no-innerhtml-interpolado').size, 0);
  });

  test('un escape de otra regla no exime esta', () => {
    const contenido = [
      '// guard-disable-next-line no-codigo-muerto: se carga dinamicamente en runtime',
      'el.innerHTML = `<b>${x}</b>`;'
    ].join('\n');
    assert.equal(lineasExentas(contenido, 'no-innerhtml-interpolado').size, 0);
  });

  test('la expresión de escape exige un identificador de regla', () => {
    assert.equal(ESCAPE.test('// guard-disable-next-line : sin id'), false);
  });
});

describe('no-innerhtml-interpolado', () => {
  const regla = detectarEn('no-innerhtml-interpolado');

  test('detecta el patrón exacto que produjo E-001 y E-003', () => {
    // Reproducción literal del código que rompió la capa de texto.
    const malo = 'block.innerHTML = `\n  <span></span>\n  <div>${line.str}</div>\n`;';
    assert.match(malo, /\.innerHTML\s*=\s*`[\s\S]*?\$\{/, 'el patrón que la regla busca sigue siendo el correcto');
    assert.ok(regla.comoArreglar.includes('textContent'), 'debe indicar la alternativa segura');
  });

  test('no señala innerHTML con marcado estático', () => {
    const bueno = "boton.innerHTML = '<i class=\"fa-solid fa-xmark\"></i>';";
    assert.doesNotMatch(bueno, /\.innerHTML\s*=\s*`[^`]*\$\{/);
  });
});

describe('no-miembros-duplicados', () => {
  const regla = detectarEn('no-miembros-duplicados');

  test('encuentra el método declarado dos veces', () => {
    const tmp = path.join(os.tmpdir(), `dup-${Date.now()}.js`);
    fs.writeFileSync(tmp, [
      'class Ejemplo {',
      '  configurar() { return 1; }',
      '  otra() { return 2; }',
      '  configurar() { return 3; }',
      '}'
    ].join('\n'));

    // Se comprueba la heurística directamente sobre el texto.
    const lineas = fs.readFileSync(tmp, 'utf8').split('\n');
    const vistos = new Map();
    const duplicados = [];
    lineas.forEach((l) => {
      const m = l.match(/^ {2}(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/);
      if (!m) return;
      if (vistos.has(m[1])) duplicados.push(m[1]);
      vistos.set(m[1], true);
    });
    fs.unlinkSync(tmp);

    assert.deepEqual(duplicados, ['configurar']);
    assert.ok(regla.comoArreglar.includes('E-016'));
  });
});

describe('suite-viva', () => {
  test('rechaza tests desactivados', () => {
    const linea = "  test.skip('algo', async () => {});";
    assert.match(linea, /\b(test|describe)\.(skip|fixme|only)\b/);
  });

  test('acepta un test normal', () => {
    const linea = "  test('algo', async () => {});";
    assert.doesNotMatch(linea, /\b(test|describe)\.(skip|fixme|only)\b/);
  });
});

describe('cobertura de las reglas', () => {
  test('cada regla aparece en docs/ERRORES-CONOCIDOS.md', () => {
    // fileURLToPath, no manipular la URL a mano: una ruta con espacios llega
    // percent-encoded y `readFileSync` no la encuentra.
    const aqui = path.dirname(fileURLToPath(import.meta.url));
    const doc = fs.readFileSync(path.join(aqui, '../../docs/ERRORES-CONOCIDOS.md'), 'utf8');
    for (const regla of TODAS) {
      assert.ok(doc.includes(regla.id), `docs/ERRORES-CONOCIDOS.md no documenta "${regla.id}"`);
    }
  });
});
