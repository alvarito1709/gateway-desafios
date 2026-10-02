/* =========================================================================
   requireSession.js — Protege el aula: solo se accede con una sesión LTI válida.

   Distingue dos situaciones para mostrar el mensaje correcto:
     • Nunca hubo sesión (acceso directo por URL) → /acceso.html
         "Ingresá desde tu aula de Moodle"
     • Había sesión y venció (cookie marcador presente) → /sesion-finalizada.html
         "Tu sesión finalizó"

   El marcador es una cookie NO sensible que el launch setea al crear sesión y
   que dura más que la sesión, así reconocemos vencimientos posteriores.

   Nunca hay login propio: la única forma de obtener sesión es el launch LTI.
   ========================================================================= */
import config from '../config.js';

export function requireSession(req, res, next) {
  if (req.session && req.session.lti) return next();

  const hadSession = !!(req.cookies && req.cookies[config.session.seenCookieName]);

  // Peticiones de API: responder 401 con motivo (el frontend decide la pantalla).
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({
      authenticated: false,
      reason: hadSession ? 'sesion_expirada' : 'sin_sesion',
    });
  }

  // Navegaciones normales: redirigir a la pantalla adecuada.
  return res.redirect(302, config.url(hadSession ? '/sesion-finalizada.html' : '/acceso.html'));
}
