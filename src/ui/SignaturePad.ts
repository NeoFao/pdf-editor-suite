import { mostrarModal } from './dialogo';
import { crearBoton, crearCabecera, crearCampo, crearCuerpo, crearPie } from './dlgPartes';

/**
 * Pad de firma: un `<dialog>` modal (QA-04: `mostrarModal` da foco inicial, trampa de Tab, Esc y foco devuelto) con un lienzo transparente donde el usuario dibuja.
 * Al confirmar entrega los píxeles RGBA (fondo transparente, trazo negro) para
 * insertarlos como imagen. No depende del motor.
 * Presentación (E-130): el lienzo se ve como un trozo de papel (`--ed-papel`, blanco en los dos temas, así el trazo negro
 * se lee también en oscuro) con una línea guía; el papel y la guía son del contenedor, NO del lienzo, de modo que los
 * píxeles que se entregan siguen siendo solo el trazo sobre transparente.
 */
export class SignaturePad {
  /** `guardar` es null salvo que el usuario marque la casilla (por defecto desmarcada: nada se guarda sin pedirlo). */
  static open(onConfirm: (rgba: Uint8Array, width: number, height: number, guardar: { nombre: string } | null) => void): void {
    const dialog = document.createElement('dialog');
    dialog.id = 'signature-pad';
    dialog.classList.add('firma-dialogo');

    const { cabecera } = crearCabecera('signature-pad-titulo', 'Dibuja tu firma');

    const ayuda = document.createElement('p');
    ayuda.className = 'dlg-mensaje';
    ayuda.textContent = 'Firma con el ratón o el dedo, apoyándote en la línea.';

    // px del lienzo (no CSS): el lienzo se escala por CSS al ancho del diálogo y `pos` lo compensa.
    const canvas = document.createElement('canvas');
    canvas.id = 'sig-canvas'; canvas.width = 400; canvas.height = 150;
    canvas.className = 'firma-lienzo-canvas';
    const ctx = canvas.getContext('2d')!;
    // guard-disable-next-line sin-color-literal-en-ui: el trazo es un DATO (la firma se inserta en negro en el PDF), no depende del tema
    ctx.strokeStyle = '#000'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const guia = document.createElement('div');
    guia.className = 'firma-guia';
    guia.setAttribute('aria-hidden', 'true');
    const papel = document.createElement('div');
    papel.className = 'firma-lienzo';
    papel.append(guia, canvas);

    // Trazos como listas de puntos (px de lienzo): permiten Deshacer repintando los anteriores.
    const trazos: Array<Array<[number, number]>> = [];
    let actual: Array<[number, number]> | null = null;
    let drawing = false;
    const btnClear = crearBoton('fantasma', 'Limpiar', 'sig-clear');
    const btnUndo = crearBoton('fantasma', 'Deshacer', 'sig-undo');
    const actualizarBotones = (): void => { btnUndo.disabled = trazos.length === 0; btnClear.disabled = trazos.length === 0; };
    const repintar = (): void => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const t of trazos) {
        ctx.beginPath(); ctx.moveTo(t[0]![0], t[0]![1]);
        for (let i = 1; i < t.length; i++) ctx.lineTo(t[i]![0], t[i]![1]);
        ctx.stroke();
      }
    };

    const pos = (e: PointerEvent): [number, number] => {
      const r = canvas.getBoundingClientRect();
      // px CSS del puntero -> px del lienzo (el lienzo se encoge con maxWidth en pantallas estrechas).
      return [(e.clientX - r.left) * (canvas.width / r.width), (e.clientY - r.top) * (canvas.height / r.height)];
    };
    canvas.addEventListener('pointerdown', (e) => { drawing = true; const p = pos(e); actual = [p]; ctx.beginPath(); ctx.moveTo(p[0], p[1]); });
    canvas.addEventListener('pointermove', (e) => {
      if (!drawing || !actual) return;
      const p = pos(e);
      ctx.lineTo(p[0], p[1]); ctx.stroke();
      // El trazo cuenta (y se puede deshacer) desde que se mueve: un simple toque no pinta nada.
      if (actual.length === 1) { trazos.push(actual); papel.classList.add('firma-lienzo--con-trazo'); actualizarBotones(); }
      actual.push(p);
    });
    const stop = (): void => { drawing = false; actual = null; };
    canvas.addEventListener('pointerup', stop);
    canvas.addEventListener('pointerleave', stop);
    // E-034: un pointercancel (gesto táctil interrumpido) sin esto dejaba
    // `drawing` en true para siempre; el trazo seguiría "pegado" al cursor
    // en el próximo pointermove que sí llegara, aunque el botón/dedo ya no
    // estuviera realmente presionando. Los listeners de este pad son del
    // propio <canvas> (no de window/document): viven y mueren con el modal,
    // así que no hay fuga de listeners que limpiar, solo este estado.
    canvas.addEventListener('pointercancel', stop);

    const guardarFila = document.createElement('label');
    guardarFila.className = 'casilla';
    const chkGuardar = document.createElement('input');
    chkGuardar.type = 'checkbox'; chkGuardar.id = 'sig-guardar'; chkGuardar.checked = false;
    guardarFila.append(chkGuardar, document.createTextNode('Guardar esta firma para usarla después'));
    const nombre = document.createElement('input');
    nombre.type = 'text'; nombre.id = 'sig-nombre'; nombre.maxLength = 40; nombre.disabled = true;
    const campos = document.createElement('div');
    campos.className = 'campos';
    campos.appendChild(crearCampo('Nombre', nombre, 'sig-nombre'));
    const privacidad = document.createElement('p');
    privacidad.className = 'campo-ayuda';
    privacidad.textContent = 'Se guarda solo en este navegador.';
    campos.appendChild(privacidad);
    chkGuardar.addEventListener('change', () => { nombre.disabled = !chkGuardar.checked; if (chkGuardar.checked) nombre.focus(); });

    const btnCancel = crearBoton('secundario', 'Cancelar', 'sig-cancel');
    const btnOk = crearBoton('primario', 'Insertar firma', 'sig-confirm');
    const izquierda = document.createElement('div');
    izquierda.className = 'dlg-pie-izq dlg-acciones';
    izquierda.append(btnUndo, btnClear);
    actualizarBotones();

    const close = (): void => dialog.close();
    btnCancel.addEventListener('click', close);
    btnUndo.addEventListener('click', () => {
      trazos.pop();
      repintar();
      if (trazos.length === 0) papel.classList.remove('firma-lienzo--con-trazo');
      actualizarBotones();
    });
    btnClear.addEventListener('click', () => {
      trazos.length = 0;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      papel.classList.remove('firma-lienzo--con-trazo');
      actualizarBotones();
    });
    btnOk.addEventListener('click', () => {
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      onConfirm(new Uint8Array(data), canvas.width, canvas.height, chkGuardar.checked ? { nombre: nombre.value } : null);
      close();
    });

    dialog.append(cabecera, crearCuerpo(ayuda, papel, guardarFila, campos), crearPie(izquierda, btnCancel, btnOk));
    mostrarModal(dialog, { tituloId: 'signature-pad-titulo' });
  }
}
