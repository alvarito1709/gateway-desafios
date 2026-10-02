/* =========================================================================
   routes/session.js — API de sesión para el frontend del aula.

   GET  /api/me     → ¿quién es el estudiante autenticado? Devuelve SOLO lo
                      necesario para la interfaz (nombre + rol). No expone
                      email, sub, deployment, contexto ni la identidad estable.
   POST /api/logout → cierra la sesión y limpia las cookies.

   La validación LTI ocurre 100% en el backend; este endpoint solo lee la
   sesión httpOnly ya establecida. El navegador nunca ve el JWT de Moodle.
   ========================================================================= */
import { Router } from 'express';
import config from '../config.js';

const router = Router();

router.get('/api/me', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const lti = req.session && req.session.lti;
  if (!lti) {
    // 401 con motivo: el cliente distingue "vencida" de "nunca hubo sesión".
    const reason = req.cookies && req.cookies[config.session.seenCookieName]
      ? 'sesion_expirada' : 'sin_sesion';
    return res.status(401).json({ authenticated: false, reason });
  }
  return res.json({
    authenticated: true,
    user: {
      name: lti.name || null,   // puede faltar si Moodle no comparte PII
      role: lti.role || 'student',
    },
  });
});

router.post('/api/logout', (req, res) => {
  const clear = () => {
    res.clearCookie(config.session.cookieName, config.cookieBase);
    res.clearCookie(config.session.seenCookieName, config.cookieBase);
    res.json({ ok: true });
  };
  if (req.session) req.session.destroy(clear);
  else clear();
});

export default router;
