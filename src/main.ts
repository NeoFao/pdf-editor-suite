import './ui/estilos.css';
import { App } from './ui/App';
import { activarDiagnosticoSiCorresponde } from './diagnostico';

// Contadores de diagnóstico (E-043, docs/ERRORES-CONOCIDOS.md): apagados por
// defecto, solo se activan con `?diagnostico=1` en la URL — ver src/diagnostico.ts.
activarDiagnosticoSiCorresponde();

const el = document.getElementById('app');
if (el) new App(el);
