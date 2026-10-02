// Destino seguro tras el launch LTI (src/lti/target.js).
// La config se lee del entorno al importar, por eso se fija ANTES de importar el módulo.
import test from 'node:test';
import assert from 'node:assert/strict';

Object.assign(process.env, {
  PUBLIC_BASE_URL: 'https://especializate.bue.edu.ar',
  BASE_PATH: '/aula/desafios',
  SESSION_SECRET: 'x'.repeat(40),
});
const { safeSameOriginTarget: target, defaultTarget } = await import('../src/lti/target.js');

const ENTRADA = '/aula/desafios/index.html';
const HOST = 'https://especializate.bue.edu.ar';

test('la entrada por defecto cuelga de BASE_PATH', () => {
  assert.equal(defaultTarget(), ENTRADA);
});

test('si Moodle manda como destino la propia URL del launch (/lti/launch), va a la entrada', () => {
  assert.equal(target(HOST + '/aula/desafios/lti/launch'), ENTRADA);
  assert.equal(target(HOST + '/aula/desafios/lti/login'), ENTRADA);
});

test('respeta páginas del aula (con query y hash)', () => {
  assert.equal(target(HOST + '/aula/desafios/modulo.html?m=2'), '/aula/desafios/modulo.html?m=2');
  assert.equal(target('/aula/desafios/unidad.html?m=1&u=3#x'), '/aula/desafios/unidad.html?m=1&u=3#x');
  assert.equal(target(HOST + '/aula/desafios'), '/aula/desafios');
});

test('rechaza otros orígenes, protocol-relative y esquemas raros (open redirect)', () => {
  assert.equal(target('https://evil.example/aula/desafios/index.html'), ENTRADA);
  assert.equal(target('//evil.example/x'), ENTRADA);
  assert.equal(target('javascript:alert(1)'), ENTRADA);
});

test('rechaza destinos fuera del prefijo (incluida el aula hermana y prefijos parciales)', () => {
  assert.equal(target(HOST + '/aula/iniciacion/index.html'), ENTRADA);
  assert.equal(target(HOST + '/aula/desafiosX/index.html'), ENTRADA);
  assert.equal(target(HOST + '/'), ENTRADA);
});

test('vacío o ausente va a la entrada', () => {
  assert.equal(target(''), ENTRADA);
  assert.equal(target(undefined), ENTRADA);
});
