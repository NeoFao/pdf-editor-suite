import { test, expect } from 'vitest';
import { cssFontFor } from '../../src/ui/cssFontFor';

test('Times-Roman: serif, peso normal, sin cursiva', () => {
  const f = cssFontFor('Times-Roman', 18);
  expect(f).toContain('serif');
  expect(f).not.toContain('sans-serif');
  expect(f).toContain('18px');
  expect(f).not.toContain('italic');
  expect(f).toContain('400');
});

test('Times-BoldItalic: serif, negrita y cursiva', () => {
  const f = cssFontFor('Times-BoldItalic', 18);
  expect(f).toContain('serif');
  expect(f).not.toContain('sans-serif');
  expect(f).toContain('italic');
  expect(f).toContain('700');
});

test('Helvetica: sans-serif, peso normal', () => {
  const f = cssFontFor('Helvetica', 12);
  expect(f).toContain('sans-serif');
  expect(f).not.toContain('italic');
  expect(f).toContain('400');
});

test('Helvetica-Bold: sans-serif, negrita', () => {
  const f = cssFontFor('Helvetica-Bold', 12);
  expect(f).toContain('sans-serif');
  expect(f).toContain('700');
});

test('Courier: monospace', () => {
  const f = cssFontFor('Courier', 10);
  expect(f).toContain('monospace');
});

test('nombre raro con prefijo de subconjunto (ABCDEF+Calibri) cae en sans-serif', () => {
  const f = cssFontFor('ABCDEF+Calibri', 14);
  expect(f).toContain('sans-serif');
});
