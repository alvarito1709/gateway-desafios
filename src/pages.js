/* =========================================================================
   pages.js — Sirve las pantallas del gateway (acceso directo / sesión vencida)
   inyectando la URL de Moodle desde config (un único lugar, sin repetir).
   Se leen una vez al arrancar y se cachean con el placeholder resuelto.
   ========================================================================= */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '../public');

function render(file) {
  const raw = fs.readFileSync(path.join(PUBLIC_DIR, file), 'utf8');
  return raw.replaceAll('{{MOODLE_URL}}', config.moodleEffectiveUrl || '#');
}

// Cache del HTML ya resuelto.
const cache = {
  'acceso.html': render('acceso.html'),
  'sesion-finalizada.html': render('sesion-finalizada.html'),
};

function serve(name) {
  return (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.type('text/html').send(cache[name]);
  };
}

export const serveAcceso = serve('acceso.html');
export const serveSesionFinalizada = serve('sesion-finalizada.html');
