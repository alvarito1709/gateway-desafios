/* =========================================================================
   config.js — Carga y valida la configuración desde variables de entorno.
   Falla temprano y con mensajes claros si falta algo crítico, para evitar
   arrancar un gateway de autenticación mal configurado.

   Este gateway protege un sitio ESTÁTICO (Desafíos): solo valida el launch
   LTI 1.3 y crea la sesión. No persiste progreso (no hay backend ni base).

   La URL de Moodle vive SOLO acá (config): las pantallas de acceso / sesión
   vencida y el frontend la reciben desde este único lugar.
   ========================================================================= */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

function str(name, def) {
  const v = process.env[name];
  return (v === undefined || v === '') ? def : v;
}
function bool(name, def = false) {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  return /^(1|true|yes|on)$/i.test(v);
}
function int(name, def) {
  const v = parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(v) ? v : def;
}
function list(name) {
  return String(process.env[name] || '').split(',').map((s) => s.trim()).filter(Boolean);
}
function stripSlash(u) { return typeof u === 'string' ? u.replace(/\/+$/, '') : u; }
// BASE_PATH: prefijo público bajo el que cuelga TODO el gateway (p. ej. /aula/desafios).
// Se normaliza a "/algo" (sin barra final) o "" si no hay prefijo.
function normalizeBasePath(v) {
  var t = String(v || '').trim().replace(/\/+$/, '');
  if (!t) return '';
  return t.startsWith('/') ? t : '/' + t;
}

const NODE_ENV = str('NODE_ENV', 'development');
const isProd = NODE_ENV === 'production';

// Nombre propio por aula: todas comparten dominio, y así sus cookies no se
// pisan ni se confunden (además van acotadas a BASE_PATH).
const sessionCookieName = str('SESSION_COOKIE_NAME', 'desafios_lti_sid');
const basePath = normalizeBasePath(str('BASE_PATH', ''));

const config = {
  env: NODE_ENV,
  isProd,
  port: int('PORT', 3002),
  // Solo el ORIGEN (https://host). La ruta pública va aparte, en BASE_PATH.
  publicBaseUrl: stripSlash(str('PUBLIC_BASE_URL', 'http://localhost:3002')),
  // Prefijo público de TODAS las rutas del gateway (ej. /aula/desafios). Nginx lo
  // reenvía sin modificarlo. Vacío = el gateway cuelga de la raíz (desarrollo).
  basePath,

  aula: {
    // Carpeta del sitio estático (proyecto desafios-especializate), servida sin modificar.
    // Puede ser absoluta (producción: /var/www/desafios-especializate) o relativa a este repo.
    dir: path.resolve(PROJECT_ROOT, str('AULA_DIR', './aula')),
    // Entrada tras un lanzamiento válido.
    entry: str('AULA_ENTRY', '/index.html'),
  },
  // Carpeta con el helper de cliente (auth.js) que el gateway inyecta.
  aulaClientDir: path.resolve(PROJECT_ROOT, str('AULA_CLIENT_DIR', './aula-client')),

  // Datos de la plataforma (Moodle). Fuente: administrador de Moodle.
  lti: {
    issuer: stripSlash(str('LTI_ISSUER', '')),
    clientId: str('LTI_CLIENT_ID', ''),
    deploymentId: str('LTI_DEPLOYMENT_ID', ''),
    authLoginUrl: str('LTI_AUTH_LOGIN_URL', ''),
    jwksUrl: str('LTI_JWKS_URL', ''),
    tokenUrl: str('LTI_TOKEN_URL', ''),
    toolPrivateKeyPem: str('LTI_TOOL_PRIVATE_KEY', '').replace(/\\n/g, '\n'),
    toolKid: str('LTI_TOOL_KID', ''),
    // Opcional: ids de curso (context.id del launch) autorizados. Vacío = cualquiera.
    // Evita que la herramienta, si queda visible en otros cursos del Moodle, sirva
    // el contenido a quienes no son del aula de egresados.
    allowedContextIds: list('LTI_ALLOWED_CONTEXT_IDS'),
    paths: {
      login: '/lti/login',
      launch: '/lti/launch',
      jwks: '/lti/jwks',
    },
  },

  moodleUrl: stripSlash(str('MOODLE_URL', '')),

  session: {
    secret: str('SESSION_SECRET', ''),
    cookieName: sessionCookieName,
    // Cookie NO sensible (marcador booleano) para distinguir "sesión vencida"
    // de "acceso directo por primera vez" en navegaciones completas.
    seenCookieName: sessionCookieName + '_seen',
    ttlMs: int('SESSION_TTL_MIN', 240) * 60 * 1000,
    // El marcador "ya entró alguna vez" vive más que la sesión (para reconocer
    // vencimientos posteriores). 30 días.
    seenTtlMs: 30 * 24 * 60 * 60 * 1000,
    embedInIframe: bool('EMBED_IN_IFRAME', false),
  },

  dev: {
    fakeLaunch: bool('DEV_FAKE_LAUNCH', false) && !isProd,
  },

  keysDir: path.resolve(PROJECT_ROOT, '.keys'),
};

// URL de Moodle efectiva para los botones "Ir/Volver a Moodle": MOODLE_URL si
// está, si no el issuer (que en Moodle es la URL base del campus).
config.moodleEffectiveUrl = config.moodleUrl || config.lti.issuer || '';

// Atributos comunes de cookies (coherentes entre sesión y marcador "seen").
config.cookieBase = {
  httpOnly: true,
  secure: config.isProd || config.session.embedInIframe,
  sameSite: config.session.embedInIframe ? 'none' : 'lax',
  // Acotada al prefijo del aula: no se envía a otras aulas del mismo dominio.
  path: basePath || '/',
};

// Ruta pública (absoluta, sin origen) de algo que cuelga del gateway.
config.url = (p) => basePath + p;

// URLs absolutas derivadas (las que se registran en Moodle).
config.lti.urls = {
  login: config.publicBaseUrl + basePath + config.lti.paths.login,
  launch: config.publicBaseUrl + basePath + config.lti.paths.launch,
  jwks: config.publicBaseUrl + basePath + config.lti.paths.jwks,
};

/* --------------------------- Validación ------------------------------- */
export function validateConfig() {
  const errors = [];
  const required = {
    LTI_ISSUER: config.lti.issuer,
    LTI_CLIENT_ID: config.lti.clientId,
    LTI_DEPLOYMENT_ID: config.lti.deploymentId,
    LTI_AUTH_LOGIN_URL: config.lti.authLoginUrl,
    LTI_JWKS_URL: config.lti.jwksUrl,
    SESSION_SECRET: config.session.secret,
  };
  for (const [k, v] of Object.entries(required)) {
    if (!v) errors.push(`Falta la variable de entorno obligatoria: ${k}`);
  }
  if (config.session.secret && config.session.secret.length < 32) {
    errors.push('SESSION_SECRET es demasiado corto: usá al menos 32 caracteres aleatorios.');
  }
  if (!config.moodleEffectiveUrl) {
    errors.push('Falta MOODLE_URL (o LTI_ISSUER) para los botones "Ir a Moodle".');
  }
  try {
    const u = new URL(config.publicBaseUrl);
    if (u.pathname !== '/' || u.search || u.hash) {
      errors.push('PUBLIC_BASE_URL debe ser solo el origen (https://host). La ruta pública va en BASE_PATH.');
    }
  } catch {
    errors.push('PUBLIC_BASE_URL no es una URL válida.');
  }
  if (!/^(\/[A-Za-z0-9._~-]+)*$/.test(config.basePath)) {
    errors.push('BASE_PATH inválido: usá algo como /aula/desafios (sin espacios ni barra final).');
  }
  if (config.basePath === '/lti' || config.basePath.startsWith('/lti/')) {
    errors.push('BASE_PATH no puede estar bajo /lti.');
  }
  const entryFile = path.join(config.aula.dir, config.aula.entry);
  if (!fs.existsSync(entryFile)) {
    errors.push(`AULA_DIR no contiene la entrada ${config.aula.entry}: no existe ${entryFile}`);
  }
  if (config.isProd && config.publicBaseUrl.startsWith('http://')) {
    errors.push('En producción PUBLIC_BASE_URL debe ser https:// (las cookies de sesión y OIDC lo requieren).');
  }
  if (config.session.embedInIframe && config.publicBaseUrl.startsWith('http://')) {
    errors.push('EMBED_IN_IFRAME=true requiere https:// (SameSite=None; Secure no funciona sobre http).');
  }
  return errors;
}

export default config;
