/* =========================================================================
   server.js — Gateway LTI 1.3 del aula Desafíos (sitio estático protegido).

   TODO cuelga de BASE_PATH (ej. /aula/desafios): Nginx reenvía la ruta completa
   sin reescribirla. Solo /healthz queda en la raíz (chequeo local, no público).

   Cadena (dentro de BASE_PATH):
     1) Cabeceras de seguridad (helmet) con framing permitido para Moodle.
     2) Parsers (form_post del launch) + cookies + sesión segura.
     3) Rutas PÚBLICAS:
          /lti/login, /lti/launch, /lti/jwks     (flujo LTI)
          /acceso.html, /sesion-finalizada.html  (pantallas, URL Moodle de config)
          /aula-client/*                         (auth.js que se inyecta)
          /api/me, /api/logout, /healthz
     4) Guard requireSession.
     5) Sitio estático existente (protegido) servido SIN modificar, con el
        bootstrap de cliente inyectado al vuelo.
   ========================================================================= */
import express from 'express';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import crypto from 'node:crypto';
import helmet from 'helmet';
import createMemoryStore from 'memorystore';

import config, { validateConfig } from './config.js';
import { initToolKeys } from './lti/keys.js';
import ltiRoutes from './routes/lti.js';
import sessionRoutes from './routes/session.js';
import { requireSession } from './middleware/requireSession.js';
import { aulaHtmlInjector, aulaStatic } from './aula.js';
import { serveAcceso, serveSesionFinalizada } from './pages.js';

async function main() {
  const errors = validateConfig();
  if (errors.length) {
    console.error('\n[config] No se puede arrancar. Revisá el .env:\n');
    errors.forEach((e) => console.error('  • ' + e));
    console.error('\n(Tomá como referencia .env.example)\n');
    process.exit(1);
  }

  await initToolKeys();

  const app = express();
  app.set('trust proxy', 1);

  // Chequeo de salud en la raíz: lo usa systemd en local; Nginx no lo publica.
  app.get('/healthz', (req, res) => res.json({ ok: true }));

  // Todo lo demás vive bajo BASE_PATH (un Router montado en el prefijo).
  const router = express.Router();

  // --- 1) Seguridad: permitir que Moodle enmarque el aula (frame-ancestors) ---
  const frameAncestors = ["'self'"];
  if (config.moodleEffectiveUrl) frameAncestors.push(config.moodleEffectiveUrl);
  // Nonce por request: permite SOLO los <script> inline que el gateway marca (aula.js los
  // etiqueta). Así la CSP sigue estricta (sin 'unsafe-inline') aunque el sitio traiga inline.
  router.use((req, res, next) => {
    res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
    next();
  });
  router.use(helmet({
    // Los videos de YouTube exigen que se envíe el origen como referrer (con
    // 'no-referrer', el default de helmet, el reproductor falla).
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'script-src': ["'self'", (req, res) => `'nonce-${res.locals.cspNonce}'`],
        'frame-ancestors': frameAncestors,
        // Desafíos incrusta videos de YouTube / Vimeo (assets/js/app.js → toEmbed).
        'frame-src': [
          "'self'",
          'https://www.youtube.com',
          'https://www.youtube-nocookie.com',
          'https://player.vimeo.com',
        ],
        'upgrade-insecure-requests': null,
      },
    },
    frameguard: false,               // usamos frame-ancestors (CSP), no X-Frame-Options
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: false,
  }));

  // --- 2) Parsers + cookies + sesión ---
  router.use(express.urlencoded({ extended: false })); // form_post del launch
  router.use(express.json({ limit: '16kb' }));
  router.use(cookieParser());

  const MemoryStore = createMemoryStore(session);
  router.use(session({
    name: config.session.cookieName,
    secret: config.session.secret,
    resave: false,
    saveUninitialized: false,
    rolling: true, // renueva la expiración con cada request → sesión "viva" mientras se usa
    store: new MemoryStore({ checkPeriod: 60 * 60 * 1000 }),
    cookie: {
      httpOnly: true,
      secure: config.cookieBase.secure,
      sameSite: config.cookieBase.sameSite,
      path: config.cookieBase.path,   // acotada a BASE_PATH: no viaja a otras aulas
      maxAge: config.session.ttlMs,
    },
  }));

  // --- 3) Rutas públicas ---
  router.use(ltiRoutes);                                   // /lti/login, /lti/launch, /lti/jwks, (dev)
  router.get('/acceso.html', serveAcceso);                 // "Ingresá desde tu aula de Moodle"
  router.get('/sesion-finalizada.html', serveSesionFinalizada); // "Tu sesión finalizó"
  router.use('/aula-client', express.static(config.aulaClientDir)); // auth.js inyectado
  router.get('/healthz', (req, res) => res.json({ ok: true }));   // también bajo el prefijo
  router.use(sessionRoutes);                               // /api/me, /api/logout

  // --- 4) Guard: de acá en adelante, todo requiere sesión LTI ---
  router.use(requireSession);

  // --- 5) Sitio estático (protegido, sin modificar, con bootstrap inyectado) ---
  router.get('/', (req, res) => res.redirect(302, config.url(config.aula.entry)));
  router.use(aulaHtmlInjector());
  router.use(aulaStatic());

  app.use(config.basePath || '/', router);

  app.listen(config.port, () => {
    console.log('\n============ Especializate · Gateway LTI 1.3 · Desafíos ============');
    console.log('  Entorno         :', config.env);
    console.log('  Escuchando en   :', config.publicBaseUrl + config.basePath, '(puerto ' + config.port + ')');
    console.log('  Sitio servido de:', config.aula.dir);
    console.log('  Entrada         :', config.aula.entry);
    console.log('  Moodle URL      :', config.moodleEffectiveUrl);
    console.log('  Cursos permitidos:', config.lti.allowedContextIds.length ? config.lti.allowedContextIds.join(', ') : '(sin restricción)');
    console.log('  Cookie sesión   :', config.session.cookieName, '(path ' + config.cookieBase.path + ')');
    console.log('  --- URLs para registrar en Moodle ---');
    console.log('  Tool / Launch   :', config.lti.urls.launch);
    console.log('  OIDC login init :', config.lti.urls.login);
    console.log('  JWKS (keyset)   :', config.lti.urls.jwks);
    if (config.dev.fakeLaunch) console.log('  [DEV] launch sim:', config.publicBaseUrl + config.url('/dev/launch'));
    console.log('==================================================================\n');
  });
}

main().catch((e) => { console.error('Fallo al arrancar el gateway:', e); process.exit(1); });
