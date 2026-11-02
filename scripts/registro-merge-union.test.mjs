/**
 * El registro docs/ERRORES-CONOCIDOS.md lleva `merge=union` en .gitattributes para
 * que dos PR que añaden cada uno una entrada al final no choquen al fusionar.
 * Este test prueba el mecanismo en un repo git temporal con el .gitattributes REAL.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analizarRegistroErrores } from './guards/reglas.mjs';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
}

function prepararRepo(atributos) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'registro-union-'));
  git(dir, 'init', '-q', '-b', 'main');
  fs.mkdirSync(path.join(dir, 'docs'));
  if (atributos) fs.writeFileSync(path.join(dir, '.gitattributes'), atributos);
  fs.writeFileSync(path.join(dir, 'docs/ERRORES-CONOCIDOS.md'), '# Registro\n\n### E-001 · base\n\ncuerpo base\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  for (const [rama, n] of [['a', '002'], ['b', '003']]) {
    git(dir, 'checkout', '-q', '-b', rama, 'main');
    fs.appendFileSync(path.join(dir, 'docs/ERRORES-CONOCIDOS.md'), `\n---\n\n### E-${n} · rama ${rama}\n\ncuerpo ${rama}\n`);
    git(dir, 'commit', '-q', '-am', `entrada ${rama}`);
  }
  git(dir, 'checkout', '-q', 'a');
  return dir;
}

function fusionar(dir) {
  try {
    git(dir, 'merge', '--no-edit', 'b');
    return true;
  } catch {
    return false;
  }
}

const lineaReal = fs.readFileSync(path.join(RAIZ, '.gitattributes'), 'utf8')
  .split('\n').find((l) => l.startsWith('docs/ERRORES-CONOCIDOS.md'));

test('el .gitattributes real declara merge=union para el registro', () => {
  assert.match(lineaReal ?? '', /^docs\/ERRORES-CONOCIDOS\.md\s+merge=union\s*$/);
});

test('con la línea real, dos ramas que añaden una entrada cada una se fusionan sin conflicto', () => {
  const dir = prepararRepo(`${lineaReal}\n`);
  try {
    assert.equal(fusionar(dir), true, 'la fusión no debe dar conflicto');
    const texto = fs.readFileSync(path.join(dir, 'docs/ERRORES-CONOCIDOS.md'), 'utf8');
    assert.match(texto, /### E-002 · rama a/);
    assert.match(texto, /### E-003 · rama b/);
    assert.deepEqual(analizarRegistroErrores(texto), [], 'el registro fusionado sigue siendo válido');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('sin la línea de .gitattributes la misma fusión SÍ conflictúa (el test es sensible)', () => {
  const dir = prepararRepo('');
  try {
    assert.equal(fusionar(dir), false, 'sin merge=union debe haber conflicto');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
