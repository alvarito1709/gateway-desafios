/* =========================================================================
   routes/lti.js — Rutas del flujo LTI 1.3:
     GET/POST  /lti/login   → OIDC Login Initiation
     POST      /lti/launch  → Launch (validación del id_token + sesión)
     GET       /lti/jwks    → JWKS público de la herramienta

   Y, solo en desarrollo (DEV_FAKE_LAUNCH=true y NODE_ENV!=production):
     GET       /dev/launch  → simula una sesión sin Moodle real (para probar el aula)
   ========================================================================= */
import { Router } from 'express';
import config from '../config.js';
import { handleLogin } from '../lti/login.js';
import { handleLaunch } from '../lti/launch.js';
import { getPublicJwks } from '../lti/keys.js';
import { stableIdFrom } from '../lti/identity.js';

const router = Router();

// OIDC Login Initiation (Moodle puede usar GET o POST).
router.get('/lti/login', handleLogin);
router.post('/lti/login', handleLogin);

// Launch: Moodle hace form_post con id_token + state.
router.post('/lti/launch', handleLaunch);

// JWKS público de la herramienta (Moodle lo consume al registrar / para AGS).
router.get('/lti/jwks', (req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.json(getPublicJwks());
});

// --- Solo desarrollo: simula un lanzamiento para probar el aula sin Moodle ---
if (config.dev.fakeLaunch) {
  router.get('/dev/launch', (req, res) => {
    const issuer = config.lti.issuer || 'https://dev.moodle.local';
    const deploymentId = config.lti.deploymentId || 'dev-deployment';
    const sub = String(req.query.sub || 'dev-student-1');
    const identity = {
      stableId: stableIdFrom(issuer, deploymentId, sub),
      issuer, sub, deploymentId,
      clientId: config.lti.clientId || 'dev-client',
      contextId: 'dev-course', contextLabel: 'DEV', contextTitle: 'Curso de prueba',
      name: 'Estudiante Demo', givenName: 'Estudiante', familyName: 'Demo',
      email: 'demo@example.com',
      roles: ['http://purl.imsglobal.org/vocab/lis/v2/membership#Learner'],
      role: 'student',
      launchedAt: new Date().toISOString(),
      __dev: true,
    };
    req.session.regenerate((err) => {
      if (err) return res.status(500).send('dev launch: sesión falló');
      req.session.lti = identity;
      req.session.save(() => {
        res.cookie(config.session.seenCookieName, '1', {
          ...config.cookieBase, maxAge: config.session.seenTtlMs,
        });
        res.redirect(302, config.url(config.aula.entry));
      });
    });
  });
}

export default router;
