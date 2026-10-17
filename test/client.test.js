// -----------------------------------------------------------------------------
// The Traefik client against the real answers of Traefik v3.7
// (test/fixtures/traefik, recorded on traefik:v3 in Docker with the file
// provider, two traefik/whoami backends behind a health check, a router to a
// missing service and one to a missing middleware), and its errors.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERROR_KINDS, TraefikClient, normalizeRawData, providerOf } from '../src/traefik/client.js';
import { normalizeConfig, parseServerUrl } from '../src/config.js';
import { BASE, FIXTURES, FakeTraefik } from './helpers/fakeTraefik.js';

const client = (traefik, extra = {}) =>
  new TraefikClient({ url: BASE, request: traefik.request, ...extra });

test('the real rawdata of Traefik v3.7: HTTP load balancers, routers in error, counts', () => {
  const { services, routers, counts } = normalizeRawData(FIXTURES.healthy);
  assert.deepEqual(
    services.map((s) => [s.name, s.provider, s.serversUp, s.serversTotal, s.healthCheck]),
    [
      ['app@file', 'file', 2, 2, true],
      ['single@file', 'file', 1, 1, false],
    ],
    'api@internal, dashboard@internal and noop@internal left out',
  );
  const broken = routers.filter((r) => r.status === 'disabled');
  assert.deepEqual(
    broken.map((r) => [r.name, r.protocol, r.errors[0]]),
    [
      ['broken-mw@file', 'http', 'middleware "missing-mw@file" does not exist'],
      ['broken@file', 'http', 'the service "missing-service@file" does not exist'],
    ],
  );
  assert.ok(routers.some((r) => r.name === 'db@file' && r.protocol === 'tcp'));
  // The same figures as /api/overview of the same Traefik.
  assert.deepEqual(counts.routers, { total: 8, errors: 2, warnings: 0 });
  assert.deepEqual(counts.services, { total: 6, errors: 0, warnings: 0 });
  assert.deepEqual(counts.middlewares, { total: 4, errors: 0, warnings: 0 });
});

test('a server DOWN after its health check fails, then every server', () => {
  const one = normalizeRawData(FIXTURES.oneDown).services.find((s) => s.name === 'app@file');
  assert.deepEqual([one.serversUp, one.serversTotal], [1, 2]);
  const all = normalizeRawData(FIXTURES.serviceDown).services.find((s) => s.name === 'app@file');
  assert.deepEqual([all.serversUp, all.serversTotal], [0, 2]);
  // Without a health check Traefik keeps the server UP.
  const single = normalizeRawData(FIXTURES.serviceDown).services.find(
    (s) => s.name === 'single@file',
  );
  assert.equal(single.serversUp, 1);
});

test('a service in error has no server up; garbage is ignored', () => {
  const { services, counts } = normalizeRawData({
    services: {
      'x@docker': { status: 'disabled', error: ['boom'], loadBalancer: { servers: [{}] } },
      'w@file': { status: 'enabled', weighted: { services: [] } },
      'bad@file': null,
    },
    routers: [],
    udpServices: { 'dns@file': { status: 'warning', loadBalancer: { servers: [] } } },
  });
  assert.deepEqual(
    services.map((s) => [s.name, s.status, s.serversUp, s.errors]),
    [['x@docker', 'disabled', 0, ['boom']]],
  );
  assert.deepEqual(counts.services, { total: 3, errors: 1, warnings: 1 });
  assert.equal(providerOf('a@b@kubernetescrd'), 'kubernetescrd');
  assert.equal(providerOf('plain'), '');
});

test('snapshot: version and rawdata, basic auth when configured', async () => {
  const traefik = new FakeTraefik({ auth: 'gladys:s3cret pw' });
  await assert.rejects(client(traefik).snapshot(), { kind: ERROR_KINDS.AUTH });
  const snapshot = await client(traefik, { username: 'gladys', password: 's3cret pw' }).snapshot();
  assert.equal(snapshot.version, '3.7.15');
  assert.equal(snapshot.services.length, 2);
  assert.deepEqual(
    traefik.requests.slice(-2).map((r) => r.url),
    [`${BASE}/api/version`, `${BASE}/api/rawdata`],
  );
});

test('errors: down, TLS, redirect, 404, 5xx, not JSON', async () => {
  const traefik = new FakeTraefik();
  traefik.failure = 'down';
  await assert.rejects(client(traefik).snapshot(), { kind: ERROR_KINDS.UNREACHABLE });
  for (const [status, kind] of [
    [302, ERROR_KINDS.REDIRECT],
    [404, ERROR_KINDS.NOT_TRAEFIK],
    [502, ERROR_KINDS.HTTP],
    [403, ERROR_KINDS.AUTH],
  ]) {
    traefik.failure = status;
    await assert.rejects(client(traefik).snapshot(), { kind }, `HTTP ${status}`);
  }
  const tls = async () => {
    const error = new TypeError('fetch failed');
    error.cause = { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' };
    throw error;
  };
  await assert.rejects(new TraefikClient({ url: BASE, request: tls }).snapshot(), {
    kind: ERROR_KINDS.TLS,
  });
  const html = async () => ({ status: 200, body: '<html>Gladys</html>' });
  await assert.rejects(new TraefikClient({ url: BASE, request: html }).snapshot(), {
    kind: ERROR_KINDS.NOT_TRAEFIK,
  });
});

test('the address: a bare host, a dashboard URL, a sub-path; no credentials in it', () => {
  assert.equal(parseServerUrl('192.0.2.10:8080'), 'http://192.0.2.10:8080');
  assert.equal(
    parseServerUrl('http://192.0.2.10:8080/dashboard/#/http/routers'),
    'http://192.0.2.10:8080',
  );
  assert.equal(
    parseServerUrl('https://proxy.example.com/api/rawdata'),
    'https://proxy.example.com',
  );
  assert.equal(parseServerUrl('https://example.com/traefik/'), 'https://example.com/traefik');
  assert.equal(parseServerUrl('http://user:pw@192.0.2.10:8080'), null);
  assert.equal(parseServerUrl('ftp://192.0.2.10'), null);
  assert.equal(normalizeConfig({}).url, '');
  assert.equal(normalizeConfig({ url: 'ftp://x' }).url, null);
  assert.deepEqual(normalizeConfig({ url: ' 192.0.2.10:8080 ', poll_interval: '7' }), {
    url: 'http://192.0.2.10:8080',
    username: '',
    password: '',
    pollIntervalMs: 60_000,
    language: 'fr',
  });
});
