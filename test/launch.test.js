// Flujo LTI completo contra un "Moodle" simulado (JWKS local + id_token firmado):
// login OIDC → launch → sesión, y la restricción opcional por curso.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import session from 'express-session';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';

const ISSUER = 'https://moodle.test';
const CLIENT = 'cid-desafios';
const DEPLOY = '7';

// --- Moodle simulado: solo publica su JWKS ---
const { publicKey, privateKey } = await generateKeyPair('RS256');
const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
const jwksServer = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ keys: [jwk] }));
});
await new Promise((r) => jwksServer.listen(0, '127.0.0.1', r));

Object.assign(process.env, {
  NODE_ENV: 'development',
  PUBLIC_BASE_URL: 'https://especializate.bue.edu.ar',
  BASE_PATH: '/aula/desafios',
  SESSION_SECRET: 'x'.repeat(40),
  LTI_ISSUER: ISSUER,
  LTI_CLIENT_ID: CLIENT,
  LTI_DEPLOYMENT_ID: DEPLOY,
  LTI_AUTH_LOGIN_URL: ISSUER + '/mod/lti/auth.php',
  LTI_JWKS_URL: 'http://127.0.0.1:' + jwksServer.address().port + '/certs',
  MOODLE_URL: ISSUER,
  LTI_ALLOWED_CONTEXT_IDS: '12',
});
const { handleLogin } = await import('../src/lti/login.js');
const { handleLaunch } = await import('../src/lti/launch.js');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(session({ secret: 'x'.repeat(40), resave: false, saveUninitialized: false }));
app.get('/lti/login', handleLogin);
app.post('/lti/launch', handleLaunch);
const appServer = http.createServer(app);
await new Promise((r) => appServer.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + appServer.address().port;

test.after(() => { jwksServer.close(); appServer.close(); });

async function startLogin() {
  const q = new URLSearchParams({
    iss: ISSUER, login_hint: 'h', client_id: CLIENT,
    target_link_uri: 'https://especializate.bue.edu.ar/aula/desafios/lti/launch',
  });
  const r = await fetch(base + '/lti/login?' + q, { redirect: 'manual' });
  assert.equal(r.status, 302);
  const loc = new URL(r.headers.get('location'));
  return { state: loc.searchParams.get('state'), nonce: loc.searchParams.get('nonce') };
}

function idToken(nonce, contextId) {
  const claims = {
    nonce,
    'https://purl.imsglobal.org/spec/lti/claim/message_type': 'LtiResourceLinkRequest',
    'https://purl.imsglobal.org/spec/lti/claim/version': '1.3.0',
    'https://purl.imsglobal.org/spec/lti/claim/deployment_id': DEPLOY,
    'https://purl.imsglobal.org/spec/lti/claim/roles': ['http://purl.imsglobal.org/vocab/lis/v2/membership#Learner'],
    'https://purl.imsglobal.org/spec/lti/claim/target_link_uri': 'https://especializate.bue.edu.ar/aula/desafios/lti/launch',
  };
  if (contextId !== undefined) claims['https://purl.imsglobal.org/spec/lti/claim/context'] = { id: contextId };
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(ISSUER).setAudience(CLIENT).setSubject('42')
    .setIssuedAt().setExpirationTime('5m').sign(privateKey);
}

async function launch(token, state) {
  return fetch(base + '/lti/launch', {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id_token: token, state }),
  });
}

test('curso autorizado: crea sesión y manda a la entrada del aula', async () => {
  const { state, nonce } = await startLogin();
  const r = await launch(await idToken(nonce, '12'), state);
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('location'), '/aula/desafios/index.html');
  assert.ok((r.headers.get('set-cookie') || '').includes('connect.sid'));
});

test('curso NO autorizado: 403 y sin sesión', async () => {
  const { state, nonce } = await startLogin();
  const r = await launch(await idToken(nonce, '99'), state);
  assert.equal(r.status, 403);
  assert.equal(r.headers.get('set-cookie'), null);
  assert.match(await r.text(), /context\.id=99/);
});

test('launch sin contexto: 403 cuando hay restricción por curso', async () => {
  const { state, nonce } = await startLogin();
  const r = await launch(await idToken(nonce, undefined), state);
  assert.equal(r.status, 403);
});

test('el state es de un solo uso (replay): segundo intento rechazado', async () => {
  const { state, nonce } = await startLogin();
  const tok = await idToken(nonce, '12');
  assert.equal((await launch(tok, state)).status, 302);
  assert.equal((await launch(tok, state)).status, 401);
});

test('token firmado con otra clave: 401', async () => {
  const { state, nonce } = await startLogin();
  const other = (await generateKeyPair('RS256')).privateKey;
  const bad = await new SignJWT({ nonce })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(ISSUER).setAudience(CLIENT).setSubject('42').setIssuedAt().setExpirationTime('5m').sign(other);
  assert.equal((await launch(bad, state)).status, 401);
});
