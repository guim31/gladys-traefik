// -----------------------------------------------------------------------------
// The hub against the SDK's fake Gladys and a fake Traefik: discovery, states,
// transitions and scene events, persistence across restarts, errors, quiet
// logs, the widget, the scene actions and the reading timer of the container.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { PROXY_KEYS, SERVICE_KEYS, proxyIds } from '../src/devices.js';
import { TRIGGERS, WIDGET_KEY } from '../src/hub.js';
import {
  BASE,
  FakeTraefik,
  createClock,
  createDevices,
  createWorld,
  idsOf,
} from './helpers/world.js';

const events = (world, key) => world.fake.sceneEvents.filter((event) => event.key === key);
const proxyState = (world, key) => world.fake.lastState(proxyIds(world.gladys).feature(key));
const serviceState = (world, name, key) => world.fake.lastState(idsOf(world, name).feature(key));

test('the proxy and one device per HTTP service in Discovery, nothing polled by Gladys', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const devices = world.fake.discoveredDevices;
  assert.deepEqual(
    devices.map((d) => d.name),
    ['Traefik', 'app@file', 'single@file'],
  );
  for (const device of devices) {
    assert.equal(device.should_poll, false);
    assert.equal(device.poll_frequency, undefined);
  }
  assert.deepEqual(devices[1].params, [{ name: 'PROVIDER', value: 'file' }]);
  assert.equal(world.fake.states.length, 0, 'nothing published for devices not added');
  assert.equal(world.fake.connectionStatus.connected, true);
  assert.equal(world.fake.sceneEvents.length, 0, 'the routers already in error are not news');
});

test('the states of the added devices at once, then only the changes', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  assert.equal(proxyState(world, PROXY_KEYS.REACHABLE), 1);
  assert.equal(proxyState(world, PROXY_KEYS.VERSION), '3.7.15');
  assert.equal(proxyState(world, PROXY_KEYS.ROUTERS_ERROR), 2);
  assert.equal(proxyState(world, PROXY_KEYS.SERVICES_DOWN), 0);
  assert.equal(proxyState(world, PROXY_KEYS.WARNINGS), 0);
  assert.equal(serviceState(world, 'app@file', SERVICE_KEYS.HEALTHY), 1);
  assert.equal(serviceState(world, 'app@file', SERVICE_KEYS.SERVERS_UP), 2);
  assert.equal(serviceState(world, 'app@file', SERVICE_KEYS.SERVERS_TOTAL), 2);
  assert.deepEqual([...new Set(world.fake.transports.map((e) => e.transport))], ['local']);

  const before = world.fake.states.length;
  await world.hub.pollNow();
  assert.equal(world.fake.states.length, before, 'nothing changed, nothing sent');

  world.traefik.setServers('app@file', 'DOWN', 'UP');
  await world.hub.pollNow();
  assert.equal(serviceState(world, 'app@file', SERVICE_KEYS.SERVERS_UP), 1);
  assert.equal(serviceState(world, 'app@file', SERVICE_KEYS.HEALTHY), 1, 'degraded is healthy');
  assert.equal(world.fake.states.length, before + 1);
  assert.equal(events(world, TRIGGERS.SERVICE_DOWN).length, 0);
});

test('a service down, then back up: events with the outage length', async (t) => {
  const clock = createClock();
  const world = await createWorld({ clock });
  t.after(() => world.app.stop());
  await createDevices(world);
  world.traefik.setServers('app@file', 'DOWN', 'DOWN');
  await world.hub.pollNow();
  assert.equal(serviceState(world, 'app@file', SERVICE_KEYS.HEALTHY), 0);
  assert.equal(proxyState(world, PROXY_KEYS.SERVICES_DOWN), 1);
  assert.deepEqual(events(world, TRIGGERS.SERVICE_DOWN)[0].data, {
    device: idsOf(world, 'app@file').device,
    service: 'app@file',
    provider: 'file',
    servers_up: 0,
    servers_total: 2,
    missing: false,
  });
  await world.hub.pollNow();
  assert.equal(events(world, TRIGGERS.SERVICE_DOWN).length, 1, 'announced once');

  clock.advance(12 * 60_000);
  world.traefik.setServers('app@file', 'UP', 'DOWN');
  await world.hub.pollNow();
  const up = events(world, TRIGGERS.SERVICE_UP);
  assert.equal(up.length, 1);
  assert.equal(up[0].data.downtime_minutes, 12);
  assert.equal(up[0].data.servers_up, 1);
});

test('a service gone from Traefik (container stopped) is down, and up when it returns', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  const removed = world.traefik.removeService('single@file');
  await world.hub.pollNow();
  assert.equal(events(world, TRIGGERS.SERVICE_DOWN).length, 0, 'one read without it is not enough');
  await world.hub.pollNow();
  assert.equal(events(world, TRIGGERS.SERVICE_DOWN)[0].data.missing, true);
  assert.equal(serviceState(world, 'single@file', SERVICE_KEYS.HEALTHY), 0);
  assert.equal(serviceState(world, 'single@file', SERVICE_KEYS.SERVERS_TOTAL), 0);
  assert.equal(world.hub.find(idsOf(world, 'single@file').device).present, false);
  assert.deepEqual(
    world.fake.discoveredDevices.map((d) => d.name),
    ['Traefik', 'app@file'],
  );
  world.traefik.rawdata.services['single@file'] = removed;
  await world.hub.pollNow();
  assert.equal(events(world, TRIGGERS.SERVICE_UP).length, 1);
  assert.equal(serviceState(world, 'single@file', SERVICE_KEYS.HEALTHY), 1);
});

test('a service gone and not added is forgotten after a week', async (t) => {
  const clock = createClock();
  const world = await createWorld({ clock });
  t.after(() => world.app.stop());
  world.traefik.removeService('single@file');
  await world.hub.pollNow();
  await world.hub.pollNow();
  assert.equal(events(world, TRIGGERS.SERVICE_DOWN).length, 1, 'fired, added or not');
  assert.equal(world.hub.services.has('single@file'), false, 'not shown when not added');
  clock.advance(8 * 24 * 3600_000);
  await world.hub.pollNow();
  assert.equal(world.hub.saved.services['single@file'], undefined);
});

test('a new service that appears broken after the first read is announced', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  world.traefik.rawdata.services['new@docker'] = {
    loadBalancer: { servers: [{ url: 'http://192.0.2.20:80' }], healthCheck: {} },
    status: 'enabled',
    serverStatus: { 'http://192.0.2.20:80': 'DOWN' },
  };
  world.traefik.rawdata.services['fine@docker'] = {
    loadBalancer: { servers: [{ url: 'http://192.0.2.21:80' }] },
    status: 'enabled',
    serverStatus: { 'http://192.0.2.21:80': 'UP' },
  };
  await world.hub.pollNow();
  assert.deepEqual(
    events(world, TRIGGERS.SERVICE_DOWN).map((e) => e.data.service),
    ['new@docker'],
  );
});

test('a router turning to error fires once, and again after it was fixed and broke', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  world.traefik.setRouterError('app@file', 'middleware "secure-headers@file" does not exist');
  await world.hub.pollNow();
  await world.hub.pollNow();
  assert.deepEqual(events(world, TRIGGERS.ROUTER_ERROR)[0].data, {
    router: 'app@file',
    provider: 'file',
    protocol: 'http',
    error: 'middleware "secure-headers@file" does not exist',
  });
  world.traefik.setRouterError('app@file', null);
  await world.hub.pollNow();
  world.traefik.setRouterError('app@file', 'again');
  await world.hub.pollNow();
  await world.hub.pollNow();
  assert.equal(events(world, TRIGGERS.ROUTER_ERROR).length, 2);
});

test('Traefik unreachable: one failed read is tolerated, the second fires once', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  world.traefik.failure = 'down';
  await world.hub.pollNow();
  assert.equal(events(world, TRIGGERS.UNREACHABLE).length, 0);
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.equal(proxyState(world, PROXY_KEYS.REACHABLE), 1);
  await world.hub.pollNow();
  await world.hub.pollNow();
  assert.deepEqual(
    events(world, TRIGGERS.UNREACHABLE).map((e) => e.data),
    [{ error: 'Traefik does not answer' }],
  );
  assert.equal(proxyState(world, PROXY_KEYS.REACHABLE), 0);
  assert.equal(world.fake.transports.at(-1).transport, 'unreachable');
  assert.equal(events(world, TRIGGERS.SERVICE_DOWN).length, 0, 'no service event for that');

  world.traefik.failure = null;
  await world.hub.pollNow();
  assert.equal(proxyState(world, PROXY_KEYS.REACHABLE), 1);
  assert.equal(world.fake.connectionStatus.connected, true);
  assert.equal(world.fake.transports.at(-1).transport, 'local');
});

test('a restart keeps the last states: a change during it is announced once', async (t) => {
  const first = await createWorld();
  await first.app.stop();
  const traefik = new FakeTraefik();
  traefik.setServers('app@file', 'DOWN', 'DOWN');
  traefik.setRouterError('single@file', 'boom');
  const second = await createWorld({ traefik, dataDir: first.dataDir });
  t.after(() => second.app.stop());
  assert.equal(events(second, TRIGGERS.SERVICE_DOWN).length, 1);
  await second.hub.pollNow(); // a router newly in error: announced at the second read
  assert.equal(events(second, TRIGGERS.ROUTER_ERROR).length, 1);
  await second.hub.store.flush();
  const third = await createWorld({ traefik, dataDir: first.dataDir });
  t.after(() => third.app.stop());
  assert.equal(third.fake.sceneEvents.length, 0, 'nothing new after a second restart');
});

test('another Traefik address starts afresh: no event for the services of the old one', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const other = new FakeTraefik();
  other.removeService('app@file');
  world.traefik.removeService('app@file');
  await world.fake.configUpdated({ url: 'http://192.0.2.10:8080/dashboard/', language: 'en' });
  await world.hub.pollNow();
  assert.equal(events(world, TRIGGERS.SERVICE_DOWN).length, 1, 'same address: still known');
  await world.fake.configUpdated({ url: 'http://198.51.100.7:8080', language: 'en' });
  assert.equal(world.fake.connectionStatus.connected, false, 'nothing answers there');
  assert.deepEqual(world.fake.discoveredDevices, [], 'the devices of the old Traefik are gone');
});

test('a restarting Traefik that has not loaded its providers yet fires nothing', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const full = structuredClone(world.traefik.rawdata);
  world.traefik.failure = 'down';
  await world.hub.pollNow();
  world.traefik.failure = null;
  world.traefik.removeService('app@file');
  world.traefik.removeService('single@file');
  world.traefik.setRouterError('app@file', 'middleware "secure-headers@file" does not exist');
  await world.hub.pollNow();
  world.traefik.rawdata = full;
  await world.hub.pollNow();
  assert.deepEqual(world.fake.sceneEvents, []);
});

test('down from the first read after a restart: reachable 0 and the unreachable badge', async (t) => {
  const first = await createWorld();
  await createDevices(first);
  await first.app.stop();
  const traefik = new FakeTraefik();
  traefik.failure = 'down';
  const second = await createWorld({
    traefik,
    dataDir: first.dataDir,
    devices: first.fake.devices,
  });
  t.after(() => second.app.stop());
  await second.hub.pollNow();
  assert.equal(events(second, TRIGGERS.UNREACHABLE).length, 1);
  assert.equal(proxyState(second, PROXY_KEYS.REACHABLE), 0);
  assert.equal(second.fake.transports.at(-1).transport, 'unreachable');
});

test('configuration missing or wrong: a readable status, no request', async (t) => {
  const world = await createWorld({ config: { language: 'fr' } });
  t.after(() => world.app.stop());
  assert.equal(world.fake.connectionStatus.connected, false);
  assert.match(world.fake.connectionStatus.message.fr, /Saisissez l'adresse/);
  assert.equal(world.traefik.requests.length, 0);
  assert.deepEqual(world.fake.discoveredDevices, []);
  const widget = await world.fake.widgetGet(WIDGET_KEY, { settings: {}, language: 'de' });
  assert.match(widget.data.content.components[0].text, /Gib die Adresse/);
  const ack = await world.fake.sceneAction('get_proxy_status', {});
  assert.equal(ack.success, false);
});

async function captureLogs(t, level, fn) {
  const lines = [];
  const write = (chunk) => {
    lines.push(...String(chunk).split('\n').filter(Boolean));
    return true;
  };
  const before = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  const stdout = t.mock.method(process.stdout, 'write', write);
  const stderr = t.mock.method(process.stderr, 'write', write);
  try {
    await fn();
  } finally {
    stdout.mock.restore();
    stderr.mock.restore();
    process.env.LOG_LEVEL = before;
  }
  return lines;
}

test('a normal reading cycle writes nothing at the info level', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  const sent = world.fake.states.length;
  const lines = await captureLogs(t, 'info', async () => {
    for (let cycle = 0; cycle < 6; cycle += 1) {
      // A degraded service changes its counts, nothing to announce.
      world.traefik.setServers('app@file', cycle % 2 ? 'UP' : 'DOWN', 'UP');
      world.clock.advance(60_000);
      await world.hub.pollNow();
    }
  });
  assert.ok(world.fake.states.length > sent, 'states were published');
  assert.deepEqual(lines, []);
});

test('a lasting failure writes one line, not one per read', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  world.traefik.failure = 'down';
  const lines = await captureLogs(t, 'info', async () => {
    for (let cycle = 0; cycle < 5; cycle += 1) {
      await world.hub.pollNow();
    }
  });
  assert.equal(lines.length, 2, lines.join('\n')); // the error, then "unreachable"
  assert.ok(!lines.join('\n').includes('Authorization'));
});

test('the widget: tiles, services down first, routers in error, within the budget', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  world.traefik.setServers('app@file', 'DOWN', 'DOWN');
  await world.hub.pollNow();
  for (const language of ['en', 'fr', 'de', 'es']) {
    const ack = await world.fake.widgetGet(WIDGET_KEY, { settings: {}, language });
    assert.equal(ack.success, true, ack.error);
    validateWidgetContent(ack.data.content);
    assert.ok(ack.data.content.components.length <= 8);
  }
  const {
    data: { content: data },
  } = await world.fake.widgetGet(WIDGET_KEY, { settings: {}, language: 'fr' });
  assert.deepEqual(
    data.components.filter((c) => c.type === 'value').map((c) => [c.label, c.value]),
    [
      ['En panne', 1],
      ['Routeurs KO', 2],
      ['En service', 1],
    ],
  );
  const [services, routers] = data.components.filter((c) => c.type === 'status');
  assert.deepEqual(
    services.items.map((i) => [i.label, i.value]),
    [
      ['app@file', 'En panne · 0/2'],
      ['single@file', 'OK · 1/1'],
    ],
  );
  assert.equal(routers.items.length, 2);
  assert.ok(routers.items.every((i) => i.value.length <= 40));

  const ack = await world.fake.widgetAction(WIDGET_KEY, 'refresh', {});
  assert.equal(ack.success, true, ack.error);
});

test('the widget limited to chosen services, and when Traefik does not answer', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  await createDevices(world);
  const chosen = { services: [idsOf(world, 'single@file').device] };
  const {
    data: { content: data },
  } = await world.fake.widgetGet(WIDGET_KEY, { settings: chosen, language: 'en' });
  const services = data.components.find((c) => c.type === 'status');
  assert.deepEqual(
    services.items.map((i) => i.label),
    ['single@file'],
  );
  world.traefik.failure = 'down';
  await world.hub.pollNow();
  const down = await world.fake.widgetGet(WIDGET_KEY, { settings: {}, language: 'en' });
  validateWidgetContent(down.data.content);
  assert.ok(down.data.content.components.some((c) => c.text === 'Traefik does not answer'));
});

test('scene actions: a service in a sentence, the whole proxy, unreachable as an answer', async (t) => {
  const clock = createClock();
  const world = await createWorld({ clock, config: { url: BASE, language: 'fr' } });
  t.after(() => world.app.stop());
  await createDevices(world);
  world.traefik.setServers('app@file', 'DOWN', 'UP');
  clock.advance(20_000);
  const service = await world.fake.sceneAction('get_service_status', {
    device: idsOf(world, 'app@file').device,
  });
  assert.deepEqual(service.data.outputs, {
    healthy: true,
    state: 'Dégradé',
    servers_up: 1,
    servers_total: 2,
    sentence: 'app@file : Dégradé, 1/2 serveur(s) en service.',
  });
  const unknown = await world.fake.sceneAction('get_service_status', { device: 'nope' });
  assert.equal(unknown.success, false);

  const proxy = await world.fake.sceneAction('get_proxy_status', {});
  assert.equal(proxy.data.outputs.reachable, true);
  assert.equal(proxy.data.outputs.routers_error, 2);
  assert.equal(proxy.data.outputs.routers, 'broken-mw@file, broken@file');
  assert.equal(
    proxy.data.outputs.sentence,
    'Traefik : 2 routeur(s) en erreur (broken-mw@file, broken@file).',
  );

  world.traefik.failure = 'down';
  clock.advance(20_000);
  const down = await world.fake.sceneAction('get_proxy_status', {});
  assert.equal(down.success, true);
  assert.equal(down.data.outputs.reachable, false);
  assert.equal(down.data.outputs.sentence, 'Traefik : Traefik ne répond pas.');
});

test('"Test the connection" sums up Traefik in the four languages', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const ack = await world.fake.action('test_connection', {});
  assert.equal(ack.success, true, ack.error);
  assert.equal(
    ack.data.message.en,
    'Traefik: Connected, Traefik 3.7.15, 2 HTTP service(s), 2 router(s) in error',
  );
  assert.match(ack.data.message.fr, /^Traefik : Connecté/);
});

test('the internal timer reads Traefik and publishes the changes, without any poll from Gladys', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const world = await createWorld({ timers: true });
  t.after(() => world.app.stop());
  await createDevices(world);
  const reads = world.traefik.requests.length;
  world.traefik.setServers('app@file', 'DOWN', 'DOWN');
  t.mock.timers.tick(60_000);
  // Let the read and the publications settle.
  for (let i = 0; i < 20; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.ok(world.traefik.requests.length > reads);
  assert.equal(serviceState(world, 'app@file', SERVICE_KEYS.HEALTHY), 0);
});

test('a damaged /data file does not block the reads', async (t) => {
  const { writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const first = await createWorld();
  await first.app.stop();
  writeFileSync(
    join(first.dataDir, 'traefik-state.json'),
    JSON.stringify({
      url: BASE,
      initialized: true,
      reachable: true,
      services: { 'x@file': null, 'app@file': 'oops' },
      routers: { 'y@file': 'z' },
    }),
  );
  const second = await createWorld({ dataDir: first.dataDir });
  t.after(() => second.app.stop());
  await second.hub.pollNow();
  assert.equal(second.fake.connectionStatus.connected, true);
  assert.equal(second.hub.services.size, 2);
});
