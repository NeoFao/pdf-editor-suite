import { describe, it, expect } from 'vitest';
import { PdfiumEngine } from '../../src/engine/pdfium/PdfiumEngine';
import { PdfError, errorDeCodigoPdfium } from '../../src/engine/errores';
import { EditSession } from '../../src/model/EditSession';

describe('apertura robusta (E-125)', () => {
  it('traduce los códigos de FPDF_GetLastError a errores tipados', () => {
    expect(errorDeCodigoPdfium(2).codigo).toBe('FILE');
    expect(errorDeCodigoPdfium(3).codigo).toBe('FORMAT');
    expect(errorDeCodigoPdfium(4).codigo).toBe('PASSWORD');
    expect(errorDeCodigoPdfium(5).codigo).toBe('SECURITY');
    expect(errorDeCodigoPdfium(6).codigo).toBe('PAGE');
    expect(errorDeCodigoPdfium(99).codigo).toBe('UNKNOWN');
  });

  it('basura y 0 bytes lanzan PdfError FORMAT sin dejar nada abierto', async () => {
    const engine = await PdfiumEngine.create();
    await expect(engine.open(new TextEncoder().encode('no soy un pdf'.repeat(40)))).rejects.toMatchObject({ codigo: 'FORMAT' });
    await expect(engine.open(new Uint8Array(0))).rejects.toBeInstanceOf(PdfError);
  });

  it('un handle cerrado da un error tipado CLOSED, no memory access out of bounds', async () => {
    const engine = await PdfiumEngine.create();
    const sesion = await EditSession.open(engine, engine.createBlank(200, 200));
    const doc = sesion.doc;
    engine.close(doc);
    expect(() => engine.renderPage(doc, 0, 1)).toThrowError(expect.objectContaining({ codigo: 'CLOSED' }));
    expect(() => engine.pageCount(doc)).toThrowError(expect.objectContaining({ codigo: 'CLOSED' }));
  });
});
