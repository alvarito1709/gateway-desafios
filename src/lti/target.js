/* =========================================================================
   target.js — Destino seguro tras un launch LTI válido.

   Moodle suele mandar como target_link_uri la propia URL del launch
   (.../lti/launch). Redirigir ahí (un GET a un endpoint que solo acepta POST)
   dejaba al estudiante fuera del aula. Por eso solo se acepta un destino que:
     1. sea de NUESTRO origen (evita open-redirect), y
     2. cuelgue de BASE_PATH (si este gateway tiene uno), y
     3. NO sea una ruta del flujo LTI (/lti/...).
   Cualquier otro caso cae en la entrada por defecto del aula.
   ========================================================================= */
import config from '../config.js';

export function defaultTarget() {
  return config.url(config.aula.entry);
}

export function safeSameOriginTarget(candidate) {
  const fallback = defaultTarget();
  if (!candidate) return fallback;
  try {
    const base = new URL(config.publicBaseUrl);
    const u = new URL(candidate, config.publicBaseUrl);
    if (u.origin !== base.origin) return fallback;

    const prefix = config.basePath;
    const underBase = prefix === '' || u.pathname === prefix || u.pathname.startsWith(prefix + '/');
    if (!underBase) return fallback;

    const rel = u.pathname.slice(prefix.length) || '/';
    if (rel === '/lti' || rel.startsWith('/lti/')) return fallback;

    return u.pathname + u.search + u.hash;
  } catch { /* noop */ }
  return fallback;
}
