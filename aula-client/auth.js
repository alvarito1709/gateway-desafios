/* =========================================================================
   auth.js — Bootstrap de sesión del aula (lo inyecta el gateway en cada página).

   Qué hace, sin tocar la lógica del aula:
     1) Pregunta al backend "¿quién soy?" vía GET /api/me (la validación LTI y la
        sesión viven en el servidor; el navegador NUNCA ve el JWT de Moodle).
     2) Si hay sesión: muestra la identidad DISCRETAMENTE dentro de la interfaz
        existente (se integra al header del sitio, junto al botón de tema; si no
        hay header, un chip discreto). No rediseña nada.
     3) Si la sesión venció mientras se usa el aula: redirige a la pantalla
        "Tu sesión finalizó" (nunca muestra usuario/contraseña).

   No guarda ningún token en localStorage/sessionStorage ni en variables JS.
   Todas las URLs cuelgan del prefijo del aula (window.__AULA_BASE__).
   ========================================================================= */
(function () {
  'use strict';

  // Prefijo público del aula (p. ej. /aula/desafios), inyectado por el gateway.
  var BASE = window.__AULA_BASE__ || '';
  var ME_URL = BASE + '/api/me';
  var EXPIRED_PAGE = BASE + '/sesion-finalizada.html';
  var RECHECK_MS = 2 * 60 * 1000; // revalida cada 2 min y al volver el foco
  var wasAuthenticated = false;

  window.AulaAuth = { user: null, ready: ready };
  var readyCbs = [], resolved = false;
  function ready(cb) { if (resolved) cb(window.AulaAuth.user); else readyCbs.push(cb); }
  function resolve() { resolved = true; readyCbs.splice(0).forEach(function (cb) { try { cb(window.AulaAuth.user); } catch (e) {} }); }

  function onExpired() {
    // Solo tratamos como "vencida" si antes estuvo autenticada en esta pantalla,
    // para no rebotar por un problema transitorio en la primera carga.
    if (wasAuthenticated && location.pathname !== EXPIRED_PAGE) {
      location.replace(EXPIRED_PAGE);
    }
  }

  function check(first) {
    fetch(ME_URL, { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(function (r) {
        if (r.status === 401) {
          if (first) { resolve(); } // la primera vez, el server ya habrá redirigido si corresponde
          else onExpired();
          return null;
        }
        return r.ok ? r.json() : null;
      })
      .then(function (data) {
        if (data && data.authenticated) {
          wasAuthenticated = true;
          window.AulaAuth.user = data.user || null;
          if (first) { resolve(); renderIdentity(data.user); }
        }
      })
      .catch(function () { /* red intermitente: no expulsamos al estudiante */ });
  }

  /* --------- Identidad discreta en la interfaz existente --------- */
  function displayName(user) {
    if (!user) return 'Estudiante';
    return user.name || 'Estudiante';
  }
  function initials(name) {
    var p = String(name || '').trim().split(/\s+/);
    return ((p[0] || '')[0] || '') + ((p[1] || '')[0] || '');
  }

  function injectStylesOnce() {
    if (document.getElementById('aula-identity-style')) return;
    var css =
      '.aula-identity{display:inline-flex;align-items:center;gap:8px;max-width:220px;' +
      'padding:4px 10px 4px 4px;border-radius:999px;background:var(--surface-2,rgba(127,127,127,.12));' +
      'border:1px solid var(--border,transparent);color:var(--ink,inherit);' +
      'font:600 13px/1 var(--font-body,system-ui),-apple-system,"Segoe UI",Roboto,sans-serif;}' +
      '.aula-identity .ai-av{flex:0 0 auto;width:24px;height:24px;border-radius:50%;' +
      'display:grid;place-items:center;background:var(--brand,#6d73ff);color:#fff;font-size:11px;' +
      'text-transform:uppercase;}' +
      '.aula-identity .ai-nm{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
      '.header-tools .aula-identity{margin-right:4px;}' +
      '.aula-identity--fixed{position:fixed;top:12px;right:14px;z-index:9999;' +
      'background:rgba(20,22,45,.9);color:#e8e9f3;box-shadow:0 4px 18px rgba(0,0,0,.25);}' +
      '@media (max-width:560px){.aula-identity{padding:4px}.aula-identity .ai-nm{display:none}}';
    var st = document.createElement('style');
    st.id = 'aula-identity-style';
    st.textContent = css;
    document.head.appendChild(st);
  }

  function buildChip(user, fixed) {
    var name = displayName(user);
    var chip = document.createElement('div');
    chip.className = 'aula-identity' + (fixed ? ' aula-identity--fixed' : '');
    chip.setAttribute('data-aula-identity', '');
    chip.title = name;
    var av = document.createElement('span'); av.className = 'ai-av'; av.textContent = initials(name) || '·';
    var nm = document.createElement('span'); nm.className = 'ai-nm'; nm.textContent = name;
    chip.appendChild(av); chip.appendChild(nm);
    return chip;
  }

  function place(user, attempt) {
    if (document.querySelector('[data-aula-identity]')) return; // ya está
    injectStylesOnce();
    var tools = document.querySelector('.header-tools');
    if (tools) { tools.insertBefore(buildChip(user, false), tools.firstChild); return; }
    // El header puede tardar un instante en estar listo: reintentamos un poco.
    if ((attempt || 0) < 20) { setTimeout(function () { place(user, (attempt || 0) + 1); }, 150); return; }
    // Sin header: chip discreto fijo.
    document.body.appendChild(buildChip(user, true));
  }

  function renderIdentity(user) {
    if (document.body) place(user, 0);
    else document.addEventListener('DOMContentLoaded', function () { place(user, 0); });
  }

  /* --------- Vigilancia del vencimiento --------- */
  check(true);
  setInterval(function () { check(false); }, RECHECK_MS);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') check(false);
  });
})();
