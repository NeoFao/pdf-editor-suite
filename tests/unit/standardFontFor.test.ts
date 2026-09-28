import { test, expect } from 'vitest';
import { standardFontFor } from '../../src/engine/standardFontFor';

test('Times-Roman -> Times-Roman', () => {
  expect(standardFontFor('Times-Roman')).toBe('Times-Roman');
});
test('Times-Bold -> Times-Bold', () => {
  expect(standardFontFor('Times-Bold')).toBe('Times-Bold');
});
test('Times-Italic -> Times-Italic', () => {
  expect(standardFontFor('Times-Italic')).toBe('Times-Italic');
});
test('Times-BoldItalic -> Times-BoldItalic', () => {
  expect(standardFontFor('Times-BoldItalic')).toBe('Times-BoldItalic');
});
test('Courier -> Courier', () => {
  expect(standardFontFor('Courier')).toBe('Courier');
});
test('Courier-Bold -> Courier-Bold', () => {
  expect(standardFontFor('Courier-Bold')).toBe('Courier-Bold');
});
test('Courier-Oblique -> Courier-Oblique', () => {
  expect(standardFontFor('Courier-Oblique')).toBe('Courier-Oblique');
});
test('Courier-BoldOblique -> Courier-BoldOblique', () => {
  expect(standardFontFor('Courier-BoldOblique')).toBe('Courier-BoldOblique');
});
test('Helvetica -> Helvetica', () => {
  expect(standardFontFor('Helvetica')).toBe('Helvetica');
});
test('Helvetica-Bold -> Helvetica-Bold', () => {
  expect(standardFontFor('Helvetica-Bold')).toBe('Helvetica-Bold');
});
test('Helvetica-Oblique -> Helvetica-Oblique', () => {
  expect(standardFontFor('Helvetica-Oblique')).toBe('Helvetica-Oblique');
});
test('Helvetica-BoldOblique -> Helvetica-BoldOblique', () => {
  expect(standardFontFor('Helvetica-BoldOblique')).toBe('Helvetica-BoldOblique');
});
test('nombre con prefijo de subconjunto (ABCDEF+Calibri) cae en Helvetica', () => {
  expect(standardFontFor('ABCDEF+Calibri')).toBe('Helvetica');
});
