import { test, expect } from 'vitest';
import { loadEngine } from '../../src/engine/pdfium/loadEngine';

test('el motor arranca y expone la API FPDF', async () => {
  const p = await loadEngine();
  expect(typeof p.FPDF_GetPageCount).toBe('function');
  expect(typeof p.FPDF_LoadMemDocument).toBe('function');
});

test('loadEngine es memoizado: misma instancia en dos llamadas', async () => {
  const a = await loadEngine();
  const b = await loadEngine();
  expect(a).toBe(b);
});
