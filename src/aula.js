/* =========================================================================
   aula.js — Sirve el sitio estático de Desafíos SIN modificar sus archivos.

   Sobre cada página .html inyecta, justo antes de </body>:
     - window.__AULA_BASE__ (prefijo público) y window.__AULA_MOODLE_URL__ (desde config);
     - /aula-client/auth.js (muestra la identidad y vigila el vencimiento de la sesión).
   Las URLs llevan el prefijo BASE_PATH. No se inyecta nada de progreso: Desafíos
   no persiste en el servidor.

   Los assets (css, js, imágenes, archivos descargables) se sirven tal cual con
   express.static con dotfiles:'ignore' (.git, .env, etc. dan 404).
   ========================================================================= */
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import config from './config.js';

const AULA_BASE = path.resolve(config.aula.dir);

// Serializa a JSON seguro para incrustar dentro de un <script> (evita cerrar la etiqueta).
function jsonForScript(v) { return JSON.stringify(v).replace(/</g, '\\u003c'); }

function tailSnippet(nonce) {
  return (
    '\n<script nonce="' + nonce + '">' +
    'window.__AULA_BASE__=' + jsonForScript(config.basePath) + ';' +
    'window.__AULA_MOODLE_URL__=' + jsonForScript(config.moodleEffectiveUrl) + ';</script>' +
    '\n<script src="' + config.url('/aula-client/auth.js') + '"></script>\n'
  );
}

// Marca con el nonce de la request cada <script> INLINE del sitio (los que no traen src).
// Los externos ya los cubre 'self'. Si un inline ya trae nonce, no se toca.
function nonceInlineScripts(html, nonce) {
  return html.replace(/<script(?![^>]*\bsrc\s*=)(?![^>]*\bnonce\s*=)([^>]*)>/gi, function (m, attrs) {
    return '<script nonce="' + nonce + '"' + attrs + '>';
  });
}

function injectInto(html, nonce) {
  html = nonceInlineScripts(html, nonce);
  var tail = tailSnippet(nonce);
  // Identidad/sesión: justo antes de </body> (o al final).
  return /<\/body>/i.test(html)
    ? html.replace(/<\/body>/i, function () { return tail + '</body>'; })
    : html + tail;
}

// Middleware: intercepta SOLO las páginas .html para inyectar el bootstrap.
export function aulaHtmlInjector() {
  return function (req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let rel;
    try { rel = decodeURIComponent(req.path); } catch { return next(); }
    if (!rel.toLowerCase().endsWith('.html')) return next();

    const filePath = path.join(AULA_BASE, rel);
    // Guarda contra path traversal: el archivo debe quedar dentro de AULA_BASE.
    if (filePath !== AULA_BASE && !filePath.startsWith(AULA_BASE + path.sep)) {
      return res.status(403).type('text/plain').send('Ruta no permitida.');
    }
    fs.readFile(filePath, 'utf8', (err, html) => {
      if (err) return next(); // no existe → que siga la cadena (404 de static)
      const out = injectInto(html, res.locals.cspNonce);
      res.set('Content-Type', 'text/html; charset=utf-8');
      res.set('Cache-Control', 'no-cache');
      if (req.method === 'HEAD') return res.end();
      res.send(out);
    });
  };
}

// Estáticos del sitio (todo lo que no sea .html: css, js, img, descargables, etc.).
export function aulaStatic() {
  // dotfiles:'ignore' es EXPLÍCITO a propósito: por defecto express solo oculta el
  // archivo si el último segmento empieza con punto, y /.git/config se serviría.
  return express.static(AULA_BASE, { index: false, dotfiles: 'ignore' });
}
