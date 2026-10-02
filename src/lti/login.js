/* =========================================================================
   login.js — OIDC Login Initiation (paso 1 del lanzamiento LTI 1.3).

   Moodle inicia el flujo llamando a este endpoint (GET o POST) con:
     iss, login_hint, target_link_uri, lti_message_hint, (client_id?, lti_deployment_id?)

   Respondemos redirigiendo el navegador al "authorization endpoint" de Moodle
   (LTI_AUTH_LOGIN_URL) con los parámetros OIDC, generando y guardando `state`
   y `nonce` (de un solo uso) para validarlos después en el launch.
   ========================================================================= */
import crypto from 'node:crypto';
import config from '../config.js';
import store from './store.js';
import { platform } from './platform.js';

function rand() { return crypto.randomBytes(32).toString('base64url'); }

export function handleLogin(req, res) {
  // Los parámetros pueden venir por query (GET) o por body (POST form).
  const params = { ...req.query, ...req.body };
  const iss = params.iss;
  const loginHint = params.login_hint;
  const targetLinkUri = params.target_link_uri;
  const messageHint = params.lti_message_hint;
  const clientIdParam = params.client_id;

  // 1) El issuer debe coincidir con el Moodle configurado.
  if (!iss || iss.replace(/\/+$/, '') !== platform.issuer) {
    return res.status(400).type('text/plain')
      .send('LTI login: issuer (iss) desconocido o ausente.');
  }
  // 2) Necesitamos login_hint para el flujo OIDC.
  if (!loginHint) {
    return res.status(400).type('text/plain').send('LTI login: falta login_hint.');
  }
  // 3) Si Moodle envía client_id, debe coincidir con el registrado.
  const clientId = clientIdParam || platform.clientId;
  if (clientIdParam && clientIdParam !== platform.clientId) {
    return res.status(400).type('text/plain').send('LTI login: client_id no coincide.');
  }

  // 4) Generamos state + nonce y guardamos la transacción (de un solo uso).
  const state = rand();
  const nonce = rand();
  store.putTransaction(state, {
    nonce,
    clientId,
    targetLinkUri: targetLinkUri || (config.publicBaseUrl + config.url(config.aula.entry)),
    createdAt: Date.now(),
  });

  // 5) Redirigimos al authorization endpoint de Moodle (auth request OIDC).
  const auth = new URL(platform.authLoginUrl);
  const q = auth.searchParams;
  q.set('scope', 'openid');
  q.set('response_type', 'id_token');
  q.set('response_mode', 'form_post');
  q.set('prompt', 'none');
  q.set('client_id', clientId);
  q.set('redirect_uri', config.lti.urls.launch);
  q.set('login_hint', loginHint);
  if (messageHint) q.set('lti_message_hint', messageHint);
  q.set('state', state);
  q.set('nonce', nonce);

  return res.redirect(302, auth.toString());
}
