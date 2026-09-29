import { test, expect } from 'vitest';
import { formatoBytes } from '../../src/ui/formatoBytes';

test('formatoBytes: menos de 1024 bytes se muestra en B', () => {
  expect(formatoBytes(500)).toBe('500 B');
});

test('formatoBytes: kilobytes con un decimal', () => {
  expect(formatoBytes(2048)).toBe('2.0 KB');
});

test('formatoBytes: megabytes con dos decimales', () => {
  expect(formatoBytes(5 * 1024 * 1024)).toBe('5.00 MB');
});
