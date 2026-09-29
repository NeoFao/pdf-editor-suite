/**
 * Pad de firma: un modal con un lienzo transparente donde el usuario dibuja.
 * Al confirmar entrega los píxeles RGBA (fondo transparente, trazo negro) para
 * insertarlos como imagen. No depende del motor.
 */
export class SignaturePad {
  static open(onConfirm: (rgba: Uint8Array, width: number, height: number) => void): void {
    const overlay = document.createElement('div');
    overlay.id = 'signature-pad';
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0', background: 'rgba(0,0,0,.45)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', zIndex: '1000'
    });

    const panel = document.createElement('div');
    Object.assign(panel.style, { background: '#fff', padding: '16px', borderRadius: '8px', font: '14px sans-serif' });

    const title = document.createElement('div');
    title.textContent = 'Dibuja tu firma'; title.style.marginBottom = '8px'; title.style.fontWeight = 'bold';

    const canvas = document.createElement('canvas');
    canvas.id = 'sig-canvas'; canvas.width = 400; canvas.height = 150;
    Object.assign(canvas.style, { border: '1px solid #cbd5e1', borderRadius: '4px', touchAction: 'none', cursor: 'crosshair', display: 'block' });
    const ctx = canvas.getContext('2d')!;
    ctx.strokeStyle = '#000'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    let drawing = false;
    const pos = (e: PointerEvent): [number, number] => {
      const r = canvas.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    canvas.addEventListener('pointerdown', (e) => { drawing = true; const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(x, y); });
    canvas.addEventListener('pointermove', (e) => { if (!drawing) return; const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke(); });
    const stop = (): void => { drawing = false; };
    canvas.addEventListener('pointerup', stop);
    canvas.addEventListener('pointerleave', stop);
    // E-034: un pointercancel (gesto táctil interrumpido) sin esto dejaba
    // `drawing` en true para siempre; el trazo seguiría "pegado" al cursor
    // en el próximo pointermove que sí llegara, aunque el botón/dedo ya no
    // estuviera realmente presionando. Los listeners de este pad son del
    // propio <canvas> (no de window/document): viven y mueren con el modal,
    // así que no hay fuga de listeners que limpiar, solo este estado.
    canvas.addEventListener('pointercancel', stop);

    const barra = document.createElement('div');
    Object.assign(barra.style, { display: 'flex', gap: '8px', marginTop: '8px', justifyContent: 'flex-end' });
    const btnCancel = document.createElement('button'); btnCancel.id = 'sig-cancel'; btnCancel.textContent = 'Cancelar';
    const btnClear = document.createElement('button'); btnClear.id = 'sig-clear'; btnClear.textContent = 'Limpiar';
    const btnOk = document.createElement('button'); btnOk.id = 'sig-confirm'; btnOk.textContent = 'Insertar firma';

    const close = (): void => overlay.remove();
    btnCancel.addEventListener('click', close);
    btnClear.addEventListener('click', () => ctx.clearRect(0, 0, canvas.width, canvas.height));
    btnOk.addEventListener('click', () => {
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      onConfirm(new Uint8Array(data), canvas.width, canvas.height);
      close();
    });

    barra.append(btnClear, btnCancel, btnOk);
    panel.append(title, canvas, barra);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
  }
}
