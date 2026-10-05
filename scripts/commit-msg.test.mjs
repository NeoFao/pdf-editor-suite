/**
 * Tests del hook `.githooks/commit-msg`: rechaza la atribución de IA en el
 * mensaje (el dueño la prohíbe; ya se coló una vez en el PR #75).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.githooks', 'commit-msg');

function correr(mensaje) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'commitmsg-'));
  const f = path.join(dir, 'MSG');
  fs.writeFileSync(f, mensaje);
  const env = { ...process.env };
  delete env.PDFEDITOR_SKIP_HOOKS;
  const r = spawnSync('sh', [HOOK, f], { encoding: 'utf8', env });
  fs.rmSync(dir, { recursive: true, force: true });
  return r;
}

test('acepta un mensaje limpio', () => {
  assert.equal(correr('feat: anotaciones reales de resaltado\n\nCuerpo normal.\n').status, 0);
});

test('rechaza Co-Authored-By en el cuerpo', () => {
  const r = correr('feat: anotaciones reales de resaltado\n\nCo-Authored-By: Alguien <a@b.c>\n');
  assert.equal(r.status, 1);
  assert.match(r.stdout, /atribuci/i);
});

test('rechaza Co-authored-by sin distinguir mayúsculas', () => {
  assert.equal(correr('feat: anotaciones reales de resaltado\n\nco-authored-by: x <x@y.z>\n').status, 1);
});

test('rechaza Claude-Session', () => {
  assert.equal(correr('feat: anotaciones reales de resaltado\n\nClaude-Session: https://claude.ai/code/s\n').status, 1);
});

test('rechaza "Generated with Claude"', () => {
  assert.equal(correr('feat: anotaciones reales de resaltado\n\nGenerated with [Claude Code](https://claude.com)\n').status, 1);
});

test('ignora las líneas de comentario (#) de git', () => {
  assert.equal(correr('feat: anotaciones reales de resaltado\n\n# Co-Authored-By: ejemplo\n').status, 0);
});
