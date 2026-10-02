/* =========================================================================
   keys.js — Par de claves de la HERRAMIENTA (nuestro lado).
   Se usa para:
     - exponer nuestro JWKS público en /lti/jwks (Moodle lo necesita al
       registrar la herramienta y para futuros servicios LTI Advantage);
     - firmar mensajes salientes en fases futuras (AGS/NRPS/Deep Linking).

   Toda la criptografía la resuelve `jose` (librería JOSE estándar y mantenida).
   No se implementa criptografía a mano.

   Estrategia de origen de la clave (en orden):
     1) LTI_TOOL_PRIVATE_KEY (PEM PKCS8) en el entorno  → producción.
     2) archivo persistido en ./.keys/tool-key.json      → dev estable.
     3) generar una nueva y persistirla                  → primer arranque.
   El kid debe ser estable para que el JWKS cacheado por Moodle siga siendo válido.
   ========================================================================= */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { generateKeyPair, exportJWK, importPKCS8, exportPKCS8, calculateJwkThumbprint } from 'jose';
import config from '../config.js';

const ALG = 'RS256';
const KEY_FILE = path.join(config.keysDir, 'tool-key.json');

let state = null; // { privateKey, publicJwk, kid }

async function fromPem(pem, kidFromEnv) {
  const privateKey = await importPKCS8(pem, ALG);
  const publicJwk = await toPublicJwk(privateKey, kidFromEnv);
  return { privateKey, publicJwk, kid: publicJwk.kid };
}

async function toPublicJwk(privateKey, kid) {
  const jwk = await exportJWK(privateKey);
  // exportJWK de una clave privada incluye componentes privados; nos quedamos
  // solo con la parte pública para publicar en el JWKS.
  const pub = { kty: jwk.kty, n: jwk.n, e: jwk.e };
  pub.use = 'sig';
  pub.alg = ALG;
  pub.kid = kid || (await calculateJwkThumbprint(pub));
  return pub;
}

function ensureKeysDir() {
  if (!fs.existsSync(config.keysDir)) fs.mkdirSync(config.keysDir, { recursive: true });
}

async function loadFromFile() {
  if (!fs.existsSync(KEY_FILE)) return null;
  try {
    const saved = JSON.parse(fs.readFileSync(KEY_FILE, 'utf8'));
    const privateKey = await importPKCS8(saved.pkcs8, ALG);
    const publicJwk = await toPublicJwk(privateKey, saved.kid);
    return { privateKey, publicJwk, kid: publicJwk.kid };
  } catch {
    return null;
  }
}

async function generateAndPersist() {
  const { privateKey } = await generateKeyPair(ALG, { extractable: true });
  const kid = config.lti.toolKid || crypto.randomUUID();
  const publicJwk = await toPublicJwk(privateKey, kid);
  try {
    ensureKeysDir();
    const pkcs8 = await exportPKCS8(privateKey);
    fs.writeFileSync(KEY_FILE, JSON.stringify({ kid, pkcs8 }, null, 2), { mode: 0o600 });
  } catch (e) {
    // Si no se puede persistir (FS de solo lectura), seguimos en memoria.
    console.warn('[keys] No se pudo persistir la clave de la herramienta:', e.message);
  }
  return { privateKey, publicJwk, kid };
}

export async function initToolKeys() {
  if (state) return state;
  if (config.lti.toolPrivateKeyPem) {
    state = await fromPem(config.lti.toolPrivateKeyPem, config.lti.toolKid);
  } else {
    state = (await loadFromFile()) || (await generateAndPersist());
  }
  return state;
}

export function getPublicJwks() {
  if (!state) throw new Error('Las claves de la herramienta no fueron inicializadas.');
  return { keys: [state.publicJwk] };
}

export function getSigningKey() {
  if (!state) throw new Error('Las claves de la herramienta no fueron inicializadas.');
  return { privateKey: state.privateKey, kid: state.kid, alg: ALG };
}
