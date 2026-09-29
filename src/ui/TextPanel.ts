/**
 * Diálogo "Texto…" (#27 de la tabla de paridad, §9): muestra el texto plano
 * de TODO el documento en un `<textarea readonly>`, con botones para
 * copiarlo al portapapeles o descargarlo como `.txt`. Mismo espíritu que el
 * modal de OCR de la app vieja (`#modal-ocr` en `index.html`: copiar +
 * descargar .txt desde un textarea de solo lectura) para no desconcertar a
 * quien ya conoce esa interacción — aquí con un `<dialog>` nativo en vez de
 * un overlay a mano, y sobre el documento ENTERO en vez de una sola página.
 *
 * Se abre solo cuando el usuario pulsa `#btn-extract-text` (no automáticamente
 * tras un OCR): el estado ya ofrece "N línea(s) reconocida(s). Pulsa «Texto…»
 * para copiarlas.", así que abrir un diálogo modal de golpe tras el OCR
 * interrumpiría cualquier otra cosa que el usuario estuviera haciendo en ese
 * instante (a diferencia de la app vieja, de una sola pestaña de escáner
 * donde ese salto automático tenía sentido). Un clic más es un coste menor
 * que un modal no pedido.
 *
 * Sin innerHTML (AGENTS.md §2.2): el texto viene del documento del usuario,
 * que es entrada no confiable; se fija con `textContent`/`.value`, nunca
 * interpolado en una plantilla.
 */
import { descargarArchivo } from './descargarArchivo';

export class TextPanel {
  static open(texto: string, nombreBase: string): void {
    const dialog = document.createElement('dialog');
    dialog.id = 'text-dialog';
    Object.assign(dialog.style, { padding: '16px', borderRadius: '8px', border: '1px solid #ccc', maxWidth: '640px', width: '90vw' });

    const titulo = document.createElement('div');
    titulo.textContent = 'Texto del documento';
    titulo.style.fontWeight = 'bold';
    titulo.style.marginBottom = '8px';

    const textarea = document.createElement('textarea');
    textarea.id = 'text-output';
    textarea.readOnly = true;
    textarea.value = texto;
    Object.assign(textarea.style, { width: '100%', height: '320px', boxSizing: 'border-box', font: '12px monospace', resize: 'vertical' });

    const aviso = document.createElement('span');
    aviso.id = 'text-copy-aviso';
    Object.assign(aviso.style, { marginLeft: '8px', fontSize: '12px', color: '#555' });

    const barra = document.createElement('div');
    Object.assign(barra.style, { display: 'flex', gap: '8px', alignItems: 'center', marginTop: '10px' });

    const btnCopiar = document.createElement('button');
    btnCopiar.id = 'btn-copy-text';
    btnCopiar.type = 'button';
    btnCopiar.textContent = 'Copiar';
    btnCopiar.addEventListener('click', () => {
      void copiarAlPortapapeles(textarea).then((ok) => {
        aviso.textContent = ok ? 'Copiado.' : 'Pulsa Ctrl+C';
      });
    });

    const btnDescargar = document.createElement('button');
    btnDescargar.id = 'btn-download-txt';
    btnDescargar.type = 'button';
    btnDescargar.textContent = 'Descargar .txt';
    // BOM UTF-8 al principio: sin él, Notepad (el editor de texto por
    // defecto en Windows) puede abrir el .txt con la codificación ANSI del
    // sistema en vez de UTF-8 y mostrar las tildes/eñes corruptas.
    btnDescargar.addEventListener('click', () => descargarArchivo(`﻿${texto}`, `${nombreBase}.txt`, 'text/plain;charset=utf-8'));

    const btnCerrar = document.createElement('button');
    btnCerrar.id = 'btn-close-text-dialog';
    btnCerrar.type = 'button';
    btnCerrar.textContent = 'Cerrar';
    btnCerrar.addEventListener('click', () => dialog.close());

    barra.append(btnCopiar, btnDescargar, btnCerrar, aviso);
    dialog.append(titulo, textarea, barra);

    dialog.addEventListener('close', () => dialog.remove());
    document.body.appendChild(dialog);
    dialog.showModal();
  }
}

/**
 * Copia el texto del textarea al portapapeles. Si `navigator.clipboard` no
 * está disponible o la llamada falla (permiso denegado, contexto no seguro),
 * cae al mismo respaldo que la app vieja nunca tuvo pero que es el estándar
 * de facto: seleccionar el textarea para que el usuario pueda pulsar Ctrl+C
 * él mismo. Devuelve si la copia automática tuvo éxito.
 */
async function copiarAlPortapapeles(textarea: HTMLTextAreaElement): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(textarea.value);
      return true;
    }
  } catch {
    // sigue al respaldo de abajo
  }
  textarea.focus();
  textarea.select();
  return false;
}
