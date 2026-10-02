/* =========================================================================
   launch.js — Launch endpoint (redirect_uri, paso 2 del lanzamiento LTI 1.3).

   Moodle hace POST (form_post) con `id_token` (un JWT firmado) y `state`.
   Acá se realiza TODA la validación en backend, con `jose` para la parte
   criptográfica (firma + claims estándar). Verificaciones:

     1. state válido y de un solo uso (CSRF).                       [store]
     2. Firma del id_token contra el JWKS de Moodle.               [jose]
     3. iss, aud, exp/iat/nbf (claims estándar).                   [jose]
     4. azp === client_id (si viene).
     5. nonce === el emitido para ese state, y no reusado (replay).[store]
     6. message_type === LtiResourceLinkRequest.
     7. version === 1.3.0.
     8. deployment_id === el configurado.
     9. sub presente.
    10. Se construye la identidad estable y se crea la sesión.

   Ante cualquier falla → 401/400 y NO se crea sesión.
   ========================================================================= */
import { jwtVerify } from 'jose';
import config from '../config.js';
import store from './store.js';
import { getPlatformJwks, platform } from './platform.js';
import {
  CLAIM, MESSAGE_TYPE_RESOURCE_LINK, LTI_VERSION,
} from './claims.js';
import { buildIdentity } from './identity.js';
import { safeSameOriginTarget } from './target.js';
import { isAllowedContext } from './context.js';

function fail(res, code, msg) {
  return res.status(code).type('text/plain').send('LTI launch rechazado: ' + msg);
}

export async function handleLaunch(req, res) {
  const idToken = req.body && req.body.id_token;
  const state = req.body && req.body.state;

  if (!idToken) return fail(res, 400, 'falta id_token.');
  if (!state) return fail(res, 400, 'falta state.');

  // 1) state: debe existir y consumirse una sola vez (protección CSRF + replay).
  const tx = store.takeTransaction(state);
  if (!tx) return fail(res, 401, 'state inválido, vencido o ya usado.');

  // 2–4) Firma + claims estándar (iss, aud, exp/iat/nbf) con jose.
  let payload;
  try {
    const jwks = getPlatformJwks();
    const verified = await jwtVerify(idToken, jwks, {
      issuer: platform.issuer,
      audience: platform.clientId,
      clockTolerance: '30s',
      maxTokenAge: '10m',
    });
    payload = verified.payload;
  } catch (e) {
    return fail(res, 401, 'firma o claims estándar inválidos (' + e.code + ').');
  }

  // 4) azp (authorized party): si está, debe ser nuestro client_id.
  if (payload.azp && payload.azp !== platform.clientId) {
    return fail(res, 401, 'azp no coincide con client_id.');
  }

  // 5) nonce: debe coincidir con el emitido para ese state y no haber sido usado.
  if (!payload.nonce || payload.nonce !== tx.nonce) {
    return fail(res, 401, 'nonce inválido.');
  }
  if (store.isNonceUsed(payload.nonce)) {
    return fail(res, 401, 'nonce ya utilizado (posible replay).');
  }
  store.markNonceUsed(payload.nonce);

  // 6) message_type
  if (payload[CLAIM.MESSAGE_TYPE] !== MESSAGE_TYPE_RESOURCE_LINK) {
    return fail(res, 400, 'message_type no soportado: ' + payload[CLAIM.MESSAGE_TYPE]);
  }
  // 7) version
  if (payload[CLAIM.VERSION] !== LTI_VERSION) {
    return fail(res, 400, 'versión LTI no soportada: ' + payload[CLAIM.VERSION]);
  }
  // 8) deployment_id
  if (payload[CLAIM.DEPLOYMENT] !== platform.deploymentId) {
    return fail(res, 401, 'deployment_id no coincide.');
  }
  // 9) sub
  if (!payload.sub) {
    return fail(res, 401, 'el id_token no trae sub.');
  }

  // 10) Curso permitido (opcional, LTI_ALLOWED_CONTEXT_IDS): solo el aula de egresados.
  const launchContextId = (payload[CLAIM.CONTEXT] || {}).id;
  if (!isAllowedContext(launchContextId)) {
    return fail(res, 403, 'este curso no está autorizado para abrir el aula (context.id=' +
      (launchContextId ?? 'ausente') + ').');
  }

  // 11) Identidad estable + sesión.
  const identity = buildIdentity(payload);

  // Destino tras el login: target_link_uri del token si cuelga de nuestro prefijo
  // y no es una ruta LTI; si no, la entrada por defecto del aula (ver target.js).
  const target = safeSameOriginTarget(
    payload[CLAIM.TARGET_URI] || tx.targetLinkUri
  );

  // Regenerar la sesión evita fijación de sesión.
  req.session.regenerate((err) => {
    if (err) return fail(res, 500, 'no se pudo crear la sesión.');
    req.session.lti = identity;
    req.session.save((err2) => {
      if (err2) return fail(res, 500, 'no se pudo guardar la sesión.');
      // Marcador NO sensible: permite reconocer un vencimiento posterior y
      // mostrar "Tu sesión finalizó" en lugar de "Ingresá desde Moodle".
      res.cookie(config.session.seenCookieName, '1', {
        ...config.cookieBase,
        maxAge: config.session.seenTtlMs,
      });
      return res.redirect(302, target);
    });
  });
}
