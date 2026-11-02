/** PDF mínimo de una página con el MediaBox dado (pt de usuario) y la cadena "HHHH" en (50, 50). Offsets del xref exactos. */
export function pdfConTamano(w: number, h: number): Uint8Array {
  const flujo = 'BT /F1 24 Tf 50 50 Td (HHHH) Tj ET';
  const objs = [
    '', '<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [4 0 R] /Count 1 >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>`,
    `<< /Length ${flujo.length} >>\nstream\n${flujo}\nendstream`
  ];
  let out = '%PDF-1.4\n';
  const off: number[] = [];
  for (let n = 1; n < objs.length; n++) { off[n] = out.length; out += `${n} 0 obj\n${objs[n]}\nendobj\n`; }
  const xref = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n`;
  for (let n = 1; n < objs.length; n++) out += `${String(off[n]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, 'latin1'));
}
