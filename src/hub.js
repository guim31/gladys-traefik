// -----------------------------------------------------------------------------
// The Traefik hub: the API read on a timer of the container (the interval
// chosen in the configuration); the states of the added devices published
// when they change, the scene events fired on transitions, and the views the
// widget and the scene actions read.
//
// Gladys never polls these devices (should_poll: false): the interval goes up
// to 5 minutes, beyond the fixed list of the core scheduler, and the scene
// events must fire for every service, added to Gladys or not — "a service goes
// down" spares the user one scene per device.
//
// The last health of each service, the routers in error and the reachability
// of Traefik are kept in /data (src/store.js): what changed while the
// integration or Gladys restarted is still announced, once.
// (Adapted from guim31/gladys-healthchecks.)
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import {
  buildProxyDevice,
  buildServiceDevice,
  isHealthy,
  proxyIds,
  proxyValues,
  serviceIds,
  serviceValues,
  stateOf,
} from './devices.js';
import { TraefikClient, TraefikError } from './traefik/client.js';
import { hostOf, normalizeConfig } from './config.js';
import { ProblemLog } from './problems.js';
import { CONNECTION_TEXT, ERROR_TEXT, REPORT_TEXT, labelled, pick } from './texts.js';

const logger = createLogger({ name: 'traefik-hub' });

export const WIDGET_KEY = 'traefik';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  SERVICE_DOWN: 'service_down',
  SERVICE_UP: 'service_up',
  ROUTER_ERROR: 'router_error',
  UNREACHABLE: 'proxy_unreachable',
});

export const HUB_TIMINGS = {
  // An unchanged value is sent again this often: Gladys shows "no recent
  // value" after 48 hours.
  heartbeatMs: 12 * 3600_000,
  // A scene action reads Traefik again when the last read is older.
  freshMs: 15_000,
  // A service gone from Traefik is remembered this long (to announce its
  // return), unless its device is added to Gladys.
  forgetMissingMs: 7 * 24 * 3600_000,
};

// Failed reads in a row before Traefik counts as unreachable: a restart of
// Traefik (a few seconds) does not fire the scenes.
export const FAILURES_BEFORE_UNREACHABLE = 2;

const MAX_TRANSPORTS_PER_REQUEST = 100;
const MAX_EVENT_TEXT = 1000;

const object = (value) => (value && typeof value === 'object' ? value : {});

export class TraefikHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} [options.request] HTTP seam (src/traefik/client.js)
   * @param {boolean} [options.timers] the reading timer (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, request, timers = true, timings, now }) {
    this.gladys = gladys;
    this.store = store;
    this.request = request;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    // Defaults until start(): a handler reached after a failed start still
    // answers with a readable message.
    this.config = normalizeConfig({});
    this.client = null;
    this.signature = null;
    /** @type {Map<string, object>} HTTP services of the last read (and the added ones gone), by name */
    this.services = new Map();
    this.routers = [];
    this.counts = null;
    this.version = '';
    this.readAt = 0;
    this.error = null;
    this.failures = 0;
    this.polling = null;
    this.transports = new Map();
    this.connection = null;
    this.discovered = null;
    this.saved = { initialized: false, reachable: null, services: {}, routers: {} };
    this.pollTimer = null;
    this.stopped = false;
    // What fails again at every cycle (Gladys refusing, the reading loop):
    // one line when it starts, one when it ends.
    this.problems = new ProblemLog(logger);
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    const saved = object(await this.store.load());
    this.saved = {
      initialized: saved.initialized === true,
      reachable: typeof saved.reachable === 'boolean' ? saved.reachable : null,
      services: object(saved.services),
      routers: object(saved.routers),
      url: typeof saved.url === 'string' ? saved.url : null,
    };
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.gladys.forgetPublishedStates?.();
    this.transports.clear();
    this.connection = null;
    this.discovered = null;
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    const languageChanged = this.signature !== null && this.config.language !== config.language;
    this.config = config;
    const signature = JSON.stringify([config.url, config.username, config.password]);
    if (signature !== this.signature) {
      this.signature = signature;
      this.client = config.url
        ? new TraefikClient({
            url: config.url,
            username: config.username,
            password: config.password,
            request: this.request,
          })
        : null;
      this.services = new Map();
      this.routers = [];
      this.counts = null;
      this.version = '';
      this.readAt = 0;
      this.error = null;
      this.failures = 0;
      this.polling = null;
      // Another Traefik: what was saved about the previous one means nothing.
      if (config.url && this.saved.url !== config.url) {
        this.saved = {
          initialized: false,
          reachable: null,
          services: {},
          routers: {},
          url: config.url,
        };
      }
    }
    if (languageChanged) {
      this.discovered = null; // new feature names for the Discovery tab
    }
    try {
      if (this.client) {
        await this.pollNow({ publish: true });
      } else {
        await this.afterChanges(true, { publish: true });
      }
    } finally {
      this.schedulePoll();
    }
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    await this.store.flush();
  }

  schedulePoll() {
    clearTimeout(this.pollTimer);
    if (!this.timersEnabled || this.stopped || !this.client) {
      return;
    }
    this.pollTimer = setTimeout(async () => {
      try {
        await this.pollNow();
        this.problems.recover('poll', 'Reading Traefik works again');
      } catch (err) {
        this.problems.fail('poll', `Poll failed: ${err.message}`, 'error');
      }
      this.schedulePoll();
    }, this.config.pollIntervalMs);
  }

  // --- Reading Traefik ---------------------------------------------------------

  /** Read Traefik now and publish what changed. */
  async pollNow({ publish = false } = {}) {
    const changed = await this.poll();
    await this.afterChanges(changed, { publish });
  }

  /** Read again when the last read is older than `freshMs` (scene actions). */
  async refreshIfStale() {
    if (this.client && this.now() - this.readAt >= this.timings.freshMs) {
      await this.pollNow();
    }
  }

  /**
   * Read Traefik and apply what changed. Concurrent calls share the read.
   * @returns {Promise<boolean>} whether the widget shows something new
   */
  poll() {
    if (!this.client) {
      return Promise.resolve(false);
    }
    if (!this.polling) {
      const polling = this.read(this.client).finally(() => {
        // A read of a previous client must not drop the promise of the current one.
        if (this.polling === polling) {
          this.polling = null;
        }
      });
      this.polling = polling;
    }
    return this.polling;
  }

  async read(client) {
    let snapshot;
    try {
      snapshot = await client.snapshot();
    } catch (err) {
      if (!(err instanceof TraefikError)) {
        throw err;
      }
      return client === this.client && this.applyFailure(err);
    }
    return client === this.client && this.applySuccess(snapshot);
  }

  /** Whether Traefik counts as reachable (after a few failed reads in a row). */
  get reachable() {
    return this.readAt > 0 && this.saved.reachable !== false && this.counts !== null;
  }

  async applySuccess({ version, services, routers, counts }) {
    const now = this.now();
    let widgetChanged = this.error !== null || this.readAt === 0;
    if (this.error || this.saved.reachable === false) {
      logger.info('Traefik answers again');
    }
    if (this.readAt === 0 || version !== this.version) {
      logger.info(
        `Traefik ${version} (${hostOf(this.config.url)}): ${services.length} HTTP service(s), ${counts.routers.total} router(s)`,
      );
    }
    let dirty = this.saved.reachable !== true || !this.saved.initialized;
    const initialized = this.saved.initialized;
    this.error = null;
    this.failures = 0;
    this.saved.reachable = true;
    this.saved.initialized = true;
    this.version = version;
    this.counts = counts;
    this.readAt = now;

    // Services: the ones Traefik lists, and the ones it no longer lists whose
    // health is still remembered.
    const next = new Map();
    for (const service of services) {
      if (!next.has(service.name)) {
        next.set(service.name, { ...service, present: true });
      }
    }
    const names = new Set([...next.keys(), ...Object.keys(this.saved.services)]);
    for (const name of names) {
      let view = next.get(name);
      if (!view) {
        const remembered = this.saved.services[name];
        const created = this.isCreated(serviceIds(this.gladys, name).device);
        const since = remembered.missingSince ?? now;
        if (!created && now - since >= this.timings.forgetMissingMs) {
          delete this.saved.services[name];
          dirty = true;
          continue;
        }
        view = {
          name,
          provider: remembered.provider ?? '',
          present: false,
          status: 'disabled',
          errors: [],
          serversUp: 0,
          serversTotal: 0,
          healthCheck: false,
        };
        if (remembered.missingSince === undefined) {
          remembered.missingSince = now;
          dirty = true;
        }
        if (created) {
          next.set(name, view); // its device stays in Gladys: shown as missing
        }
      }
      const previous = this.services.get(name);
      if (next.has(name) && (!previous || stateOf(previous) !== stateOf(view))) {
        widgetChanged = true;
      }
      dirty = (await this.transition(view, initialized)) || dirty;
    }
    if ([...this.services.keys()].some((name) => !next.has(name))) {
      widgetChanged = true; // a service gone
    }
    this.services = next;

    // Routers in error: announced once when they enter the error state.
    const inError = routers.filter((router) => router.status === 'disabled');
    const before = JSON.stringify(this.routers.filter((router) => router.status === 'disabled'));
    if (JSON.stringify(inError) !== before) {
      widgetChanged = true;
    }
    this.routers = routers;
    const errorNames = new Set(inError.map((router) => router.name));
    for (const name of Object.keys(this.saved.routers)) {
      if (!errorNames.has(name)) {
        delete this.saved.routers[name];
        dirty = true;
      }
    }
    for (const router of inError) {
      if (this.saved.routers[router.name] !== undefined) {
        continue;
      }
      this.saved.routers[router.name] = now;
      dirty = true;
      // Nothing announced on the very first read: these errors are not new.
      if (initialized) {
        logger.info(`Router ${router.name} in error: ${router.errors[0] ?? 'no detail'}`);
        await this.fire(TRIGGERS.ROUTER_ERROR, {
          router: router.name,
          provider: router.provider,
          protocol: router.protocol,
          error: (router.errors.join(' · ') || '-').slice(0, MAX_EVENT_TEXT),
        });
      }
    }

    // Written only when something changed: no wear of the SD card at every read.
    if (dirty) {
      this.store.save(this.saved);
    }
    await this.publishStates();
    return widgetChanged;
  }

  async applyFailure(err) {
    const wasError = this.error?.kind;
    this.error = { kind: err.kind, message: err.message };
    this.failures += 1;
    this.readAt = this.now();
    if (wasError !== err.kind) {
      logger.warn(`Traefik: ${err.message}`);
    }
    if (this.failures >= FAILURES_BEFORE_UNREACHABLE && this.saved.reachable !== false) {
      const wasReachable = this.saved.reachable === true;
      this.saved.reachable = false;
      this.store.save(this.saved);
      if (wasReachable) {
        logger.info('Traefik is unreachable');
        await this.fire(TRIGGERS.UNREACHABLE, {
          error: pick(ERROR_TEXT[err.kind], this.config.language),
        });
      }
      await this.publishStates();
    }
    return wasError !== err.kind;
  }

  /**
   * Compare a service with its last health; fire the scene events.
   * @returns {boolean} whether the saved state changed
   */
  async transition(service, initialized) {
    const previous = this.saved.services[service.name];
    const healthy = isHealthy(service);
    const now = this.now();
    let dirty = false;
    if (service.present && previous?.missingSince !== undefined) {
      delete previous.missingSince;
      dirty = true;
    }
    if (previous?.provider !== service.provider && service.provider) {
      this.saved.services[service.name] = { ...previous, provider: service.provider };
      dirty = true;
    }
    if (previous?.healthy === healthy) {
      return dirty;
    }
    this.saved.services[service.name] = {
      ...this.saved.services[service.name],
      healthy,
      since: now,
    };
    // A service seen for the first time is announced only when it appears
    // already down after the first read (a new container that fails).
    if (!previous && (healthy || !initialized)) {
      return true;
    }
    const data = {
      device: serviceIds(this.gladys, service.name).device,
      service: service.name,
      provider: service.provider,
      servers_up: service.serversUp,
      servers_total: service.serversTotal,
    };
    if (!healthy) {
      logger.info(`Service ${service.name} is ${service.present ? 'down' : 'gone'}`);
      await this.fire(TRIGGERS.SERVICE_DOWN, { ...data, missing: !service.present });
    } else {
      const minutes = Math.max(0, Math.round((now - (previous.since ?? now)) / 60_000));
      logger.info(`Service ${service.name} is up again after ${minutes} min`);
      await this.fire(TRIGGERS.SERVICE_UP, { ...data, downtime_minutes: minutes });
    }
    return true;
  }

  async fire(key, data) {
    try {
      await this.gladys.publishSceneEvent(key, data);
    } catch (err) {
      logger.warn(`Scene event ${key} refused: ${err.message}`);
    }
  }

  // --- Publishing to Gladys ----------------------------------------------------

  isCreated(externalId) {
    return (this.gladys.devices ?? []).some((device) => device.external_id === externalId);
  }

  discoveredDevices() {
    if (!this.client || !this.reachable) {
      return null; // nothing read: keep the list Gladys has
    }
    const language = this.config.language;
    return [
      buildProxyDevice(this.gladys, language),
      ...[...this.services.values()]
        .filter((service) => service.present)
        .map((service) => buildServiceDevice(this.gladys, service, language)),
    ];
  }

  /** Publish the Discovery list when it changed (a service added, a language…). */
  async publishDevices({ force = false } = {}) {
    const devices = this.discoveredDevices() ?? (this.client ? null : []);
    if (devices === null) {
      return;
    }
    const key = JSON.stringify(devices);
    if (!force && key === this.discovered) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.discovered = key;
      this.problems.recover('discovered', 'Discovered devices accepted again');
    } catch (err) {
      this.problems.fail('discovered', `Discovered devices refused: ${err.message}`);
    }
  }

  /** "Search" in the Discovery tab: read Traefik, publish the list again. */
  async rediscover() {
    await this.poll();
    await this.afterChanges(true, { publish: true });
  }

  /**
   * The user added (or updated) a device: its states sent before were dropped
   * by Gladys, and a device deleted then added again needs its badge.
   */
  async onDeviceCreated(device) {
    this.transports.delete(device.external_id);
    await this.publishStates();
    await this.publishTransports();
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  /** Gladys asks for a refresh (onPoll, only if it polls anyway). */
  async pollDevice() {
    await this.pollNow();
  }

  /**
   * The states of the added devices. The SDK skips the values Gladys already
   * has (and sends an unchanged one again after `heartbeatMs`).
   */
  async publishStates() {
    if (this.readAt === 0 || this.counts === null) {
      return; // never read: nothing to tell
    }
    const states = [];
    if (this.reachable) {
      for (const service of this.services.values()) {
        if (this.isCreated(serviceIds(this.gladys, service.name).device)) {
          states.push(...serviceValues(this.gladys, service));
        }
      }
    }
    if (this.isCreated(proxyIds(this.gladys).device)) {
      states.push(
        ...proxyValues(this.gladys, {
          reachable: this.reachable,
          version: this.version,
          counts: this.counts,
          services: [...this.services.values()],
        }),
      );
    }
    if (states.length === 0) {
      return;
    }
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
      this.problems.recover('states', 'States accepted again');
    } catch (err) {
      this.problems.fail('states', `States refused: ${err.message}`);
    }
  }

  async afterChanges(widgetChanged, { publish = false } = {}) {
    await this.publishDevices({ force: publish });
    await this.publishTransports();
    await this.publishConnectionStatus();
    if (widgetChanged) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  /** The badge of the added devices: local, or unreachable. */
  async publishTransports() {
    if (!this.client || this.readAt === 0 || this.counts === null) {
      return;
    }
    const transport = this.reachable ? DEVICE_TRANSPORTS.LOCAL : DEVICE_TRANSPORTS.UNREACHABLE;
    const entries = [];
    const ids = [
      proxyIds(this.gladys).device,
      ...[...this.services.keys()].map((name) => serviceIds(this.gladys, name).device),
    ];
    for (const externalId of ids) {
      if (this.isCreated(externalId) && this.transports.get(externalId) !== transport) {
        entries.push({ external_id: externalId, transport });
      }
    }
    for (let at = 0; at < entries.length; at += MAX_TRANSPORTS_PER_REQUEST) {
      const batch = entries.slice(at, at + MAX_TRANSPORTS_PER_REQUEST);
      try {
        await this.gladys.publishTransports(batch);
        for (const entry of batch) {
          this.transports.set(entry.external_id, entry.transport);
        }
        this.problems.recover('transports', 'Transports accepted again');
      } catch (err) {
        this.problems.fail('transports', `Transports refused: ${err.message}`);
      }
    }
  }

  /** The status under the integration name. */
  connectionStatus() {
    if (this.config.url === '') {
      return { connected: false, message: CONNECTION_TEXT.noUrl };
    }
    if (!this.config.url) {
      return { connected: false, message: CONNECTION_TEXT.invalidUrl };
    }
    if (this.error) {
      return { connected: false, message: ERROR_TEXT[this.error.kind] };
    }
    return { connected: true };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.problems.recover('connection', 'Connection status accepted again');
    } catch (err) {
      this.problems.fail('connection', `Connection status refused: ${err.message}`);
    }
  }

  // --- Views (widget, scene actions, report) -----------------------------------

  /** The service of a device external id, null when it is not one of ours. */
  find(externalId) {
    if (typeof externalId !== 'string') {
      return null;
    }
    for (const service of this.services.values()) {
      if (serviceIds(this.gladys, service.name).device === externalId) {
        return service;
      }
    }
    return null;
  }

  /** The routers in error of the last read. */
  routersInError() {
    return this.routers.filter((router) => router.status === 'disabled');
  }

  /** Throws the reason Traefik cannot answer, if any. */
  assertReadable() {
    const status = this.connectionStatus();
    if (!status.connected) {
      throw new Error(pick(status.message, this.config.language));
    }
  }

  /** "Test the connection": read Traefik now, one line. */
  async testConnection() {
    await this.pollNow({ publish: true });
    const message = {};
    for (const [language, text] of Object.entries(REPORT_TEXT)) {
      const status = this.connectionStatus();
      if (!status.connected) {
        message[language] = pick(status.message, language);
        continue;
      }
      const services = [...this.services.values()].filter((service) => service.present);
      const parts = [`${text.ok}, Traefik ${this.version}`, text.services(services.length)];
      const down = services.filter((service) => !isHealthy(service)).length;
      if (down > 0) {
        parts.push(text.down(down));
      }
      const routers = this.routersInError().length;
      if (routers > 0) {
        parts.push(text.routers(routers));
      }
      message[language] = labelled('Traefik', parts.join(', '), language);
    }
    return message;
  }
}
