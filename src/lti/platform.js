/* =========================================================================
   platform.js — Datos de la PLATAFORMA (Moodle) y su JWKS remoto.

   `createRemoteJWKSet` de `jose` descarga el JWKS de Moodle
   (LTI_JWKS_URL / mod/lti/certs.php), cachea las claves, refresca cuando
   aparece un `kid` nuevo y selecciona la clave correcta para verificar la
   firma del id_token. Es la "consulta de JWKS de Moodle" + validación de
   firma resuelta por una librería estándar (sin criptografía manual).
   ========================================================================= */
import { createRemoteJWKSet } from 'jose';
import config from '../config.js';

let remoteJwks = null;

export function getPlatformJwks() {
  if (!config.lti.jwksUrl) throw new Error('LTI_JWKS_URL no está configurado.');
  if (!remoteJwks) {
    remoteJwks = createRemoteJWKSet(new URL(config.lti.jwksUrl), {
      // Cache y refresco de claves controlado por jose.
      cacheMaxAge: 10 * 60 * 1000,   // 10 min
      cooldownDuration: 30 * 1000,   // no re-descarga más de 1 vez cada 30 s
      timeoutDuration: 5 * 1000,     // timeout de la descarga
    });
  }
  return remoteJwks;
}

export const platform = {
  issuer: config.lti.issuer,
  clientId: config.lti.clientId,
  deploymentId: config.lti.deploymentId,
  authLoginUrl: config.lti.authLoginUrl,
  jwksUrl: config.lti.jwksUrl,
  tokenUrl: config.lti.tokenUrl,
};
