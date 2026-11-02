import { createHash } from 'node:crypto';

/**
 * PDFs construidos a mano para los E2E de apertura robusta (E-125). Sin dependencias
 * ni descargas: PDFium no cifra al guardar y qpdf no se puede asumir instalado.
 *
 * Cifrado: RC4 de 40 bits (/V 1 /R 2, Algoritmos 2, 3 y 4 de la ISO 32000-1 §7.6.3).
 * Contraseña de USUARIO = `CLAVE_PRUEBA`; sin contraseña de propietario (se usa la de usuario).
 */
export const CLAVE_PRUEBA = 'prueba123';

const RELLENO = Buffer.from('28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A', 'hex');

function md5(...partes: Buffer[]): Buffer {
  const h = createHash('md5');
  for (const p of partes) h.update(p);
  return h.digest();
}

/** RC4 (implementado a mano: OpenSSL 3 ya no lo trae por defecto). */
function rc4(clave: Buffer, datos: Buffer): Buffer {
  const s = Array.from({ length: 256 }, (_, i) => i);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i]! + clave[i % clave.length]!) & 255;
    [s[i], s[j]] = [s[j]!, s[i]!];
  }
  const salida = Buffer.alloc(datos.length);
  let a = 0;
  let b = 0;
  for (let k = 0; k < datos.length; k++) {
    a = (a + 1) & 255;
    b = (b + s[a]!) & 255;
    [s[a], s[b]] = [s[b]!, s[a]!];
    salida[k] = datos[k]! ^ s[(s[a]! + s[b]!) & 255]!;
  }
  return salida;
}

function rellenar(clave: string): Buffer {
  return Buffer.concat([Buffer.from(clave, 'latin1'), RELLENO]).subarray(0, 32);
}

/** Ensambla un PDF con tabla xref correcta. `objetos[i]` es el cuerpo del objeto i+1. */
function ensamblar(objetos: Buffer[], trailerExtra: string): Buffer {
  const partes: Buffer[] = [Buffer.from('%PDF-1.4\n', 'latin1')];
  const offsets: number[] = [];
  let pos = partes[0]!.length;
  objetos.forEach((cuerpo, i) => {
    offsets.push(pos);
    const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), cuerpo, Buffer.from('\nendobj\n', 'latin1')]);
    partes.push(b);
    pos += b.length;
  });
  const xref = [`xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`]
    .concat(offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`))
    .join('');
  partes.push(Buffer.from(`${xref}trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R ${trailerExtra}>>\nstartxref\n${pos}\n%%EOF\n`, 'latin1'));
  return Buffer.concat(partes);
}

/** PDF de una página con el texto «Hola cifrado», cifrado con RC4-40 y contraseña de usuario `CLAVE_PRUEBA`. */
export function pdfCifrado(): Buffer {
  const id = Buffer.from('0123456789abcdef', 'latin1');
  const p = -4; // permisos: todo menos lo reservado
  const pLe = Buffer.alloc(4);
  pLe.writeInt32LE(p);
  const o = rc4(md5(rellenar(CLAVE_PRUEBA)).subarray(0, 5), rellenar(CLAVE_PRUEBA));
  const clave = md5(rellenar(CLAVE_PRUEBA), o, pLe, id).subarray(0, 5);
  const u = rc4(clave, RELLENO);
  const claveObjeto = (n: number): Buffer => md5(clave, Buffer.from([n & 255, (n >> 8) & 255, (n >> 16) & 255, 0, 0])).subarray(0, 10);
  const contenido = rc4(claveObjeto(4), Buffer.from('BT /F1 24 Tf 72 700 Td (Hola cifrado) Tj ET', 'latin1'));
  const L = (s: string): Buffer => Buffer.from(s, 'latin1');
  const objetos = [
    L('<< /Type /Catalog /Pages 2 0 R >>'),
    L('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    L('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>'),
    Buffer.concat([L(`<< /Length ${contenido.length} >>\nstream\n`), contenido, L('\nendstream')]),
    L('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
    L(`<< /Filter /Standard /V 1 /R 2 /P ${p} /O <${o.toString('hex')}> /U <${u.toString('hex')}> >>`)
  ];
  return ensamblar(objetos, `/Encrypt 6 0 R /ID [<${id.toString('hex')}> <${id.toString('hex')}>] `);
}

/** Árbol de páginas cíclico: el nodo /Pages se contiene a sí mismo como hijo. */
export function pdfArbolCiclico(): Buffer {
  const L = (s: string): Buffer => Buffer.from(s, 'latin1');
  return ensamblar([
    L('<< /Type /Catalog /Pages 2 0 R >>'),
    L('<< /Type /Pages /Kids [2 0 R] /Count 1 >>')
  ], '');
}

export const BASURA = Buffer.from('esto no es un pdf, solo basura '.repeat(50), 'latin1');
export const VACIO = Buffer.alloc(0);
export function truncado(pdf: Buffer): Buffer { return pdf.subarray(0, Math.min(300, Math.floor(pdf.length / 2))); }
