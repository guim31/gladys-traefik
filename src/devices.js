// -----------------------------------------------------------------------------
// Gladys devices, proposed in the Discovery tab (the user adds the ones to
// follow, nothing is created on their behalf):
//
//   - one "Traefik" device for the proxy:
//       reachable            input/binary    1 the API answers, 0 otherwise
//       version              text/text       e.g. "3.7.15"
//       routers_error        counter-sensor  routers in error (HTTP, TCP, UDP)
//       services_error       counter-sensor  services in error
//       middlewares_error    counter-sensor  middlewares in error
//       warnings             counter-sensor  routers, services and
//                                            middlewares with a warning
//       services_down        counter-sensor  HTTP services without any server
//                                            up (or gone, once added to Gladys)
//
//   - one device per HTTP load balancer service (`app@docker`…), identified by
//     its Traefik name (`@internal` services left out):
//       healthy              input/binary    1 at least one server up
//       servers_up           counter-sensor  servers UP
//       servers_total        counter-sensor  servers declared
//
// Published with should_poll: false: the integration reads Traefik on its own
// timer (src/hub.js), at the interval chosen in the configuration.
// -----------------------------------------------------------------------------

import { DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES } from '@gladysassistant/integration-sdk';

export const PROXY_TYPE = 'proxy';
export const PROXY_ID = 'main';
export const SERVICE_TYPE = 'service';
export const MODEL = 'Traefik';

// Suffixes of the feature external ids: permanent once published.
export const PROXY_KEYS = Object.freeze({
  REACHABLE: 'reachable',
  VERSION: 'version',
  ROUTERS_ERROR: 'routers_error',
  SERVICES_ERROR: 'services_error',
  MIDDLEWARES_ERROR: 'middlewares_error',
  WARNINGS: 'warnings',
  SERVICES_DOWN: 'services_down',
});

export const SERVICE_KEYS = Object.freeze({
  HEALTHY: 'healthy',
  SERVERS_UP: 'servers_up',
  SERVERS_TOTAL: 'servers_total',
});

// Feature names, in the language chosen in the configuration (Gladys does not
// tell a device integration the user's language). Frozen at creation in Gladys.
export const NAMES = {
  en: {
    [PROXY_KEYS.REACHABLE]: 'Reachable',
    [PROXY_KEYS.VERSION]: 'Version',
    [PROXY_KEYS.ROUTERS_ERROR]: 'Routers in error',
    [PROXY_KEYS.SERVICES_ERROR]: 'Services in error',
    [PROXY_KEYS.MIDDLEWARES_ERROR]: 'Middlewares in error',
    [PROXY_KEYS.WARNINGS]: 'Warnings',
    [PROXY_KEYS.SERVICES_DOWN]: 'Services down',
    [SERVICE_KEYS.HEALTHY]: 'Healthy',
    [SERVICE_KEYS.SERVERS_UP]: 'Servers up',
    [SERVICE_KEYS.SERVERS_TOTAL]: 'Servers in total',
  },
  fr: {
    [PROXY_KEYS.REACHABLE]: 'Joignable',
    [PROXY_KEYS.VERSION]: 'Version',
    [PROXY_KEYS.ROUTERS_ERROR]: 'Routeurs en erreur',
    [PROXY_KEYS.SERVICES_ERROR]: 'Services en erreur',
    [PROXY_KEYS.MIDDLEWARES_ERROR]: 'Middlewares en erreur',
    [PROXY_KEYS.WARNINGS]: 'Avertissements',
    [PROXY_KEYS.SERVICES_DOWN]: 'Services en panne',
    [SERVICE_KEYS.HEALTHY]: 'En bonne santé',
    [SERVICE_KEYS.SERVERS_UP]: 'Serveurs en service',
    [SERVICE_KEYS.SERVERS_TOTAL]: 'Serveurs au total',
  },
  de: {
    [PROXY_KEYS.REACHABLE]: 'Erreichbar',
    [PROXY_KEYS.VERSION]: 'Version',
    [PROXY_KEYS.ROUTERS_ERROR]: 'Router mit Fehler',
    [PROXY_KEYS.SERVICES_ERROR]: 'Dienste mit Fehler',
    [PROXY_KEYS.MIDDLEWARES_ERROR]: 'Middlewares mit Fehler',
    [PROXY_KEYS.WARNINGS]: 'Warnungen',
    [PROXY_KEYS.SERVICES_DOWN]: 'Ausgefallene Dienste',
    [SERVICE_KEYS.HEALTHY]: 'Funktionsfähig',
    [SERVICE_KEYS.SERVERS_UP]: 'Erreichbare Server',
    [SERVICE_KEYS.SERVERS_TOTAL]: 'Server insgesamt',
  },
  es: {
    [PROXY_KEYS.REACHABLE]: 'Accesible',
    [PROXY_KEYS.VERSION]: 'Versión',
    [PROXY_KEYS.ROUTERS_ERROR]: 'Routers con error',
    [PROXY_KEYS.SERVICES_ERROR]: 'Servicios con error',
    [PROXY_KEYS.MIDDLEWARES_ERROR]: 'Middlewares con error',
    [PROXY_KEYS.WARNINGS]: 'Advertencias',
    [PROXY_KEYS.SERVICES_DOWN]: 'Servicios caídos',
    [SERVICE_KEYS.HEALTHY]: 'En buen estado',
    [SERVICE_KEYS.SERVERS_UP]: 'Servidores activos',
    [SERVICE_KEYS.SERVERS_TOTAL]: 'Servidores en total',
  },
};

// Display bounds (the core never applies them on write).
export const MAX_COUNT = 10_000;
export const MAX_SERVERS = 1_000;

/**
 * The state of a service: up (every server up), degraded (some), down (none,
 * or the service in error), missing (gone from Traefik: a Docker container
 * stopped takes its service with it).
 * @returns {'up'|'degraded'|'down'|'missing'}
 */
export function stateOf(service) {
  if (!service.present) {
    return 'missing';
  }
  if (service.serversUp === 0) {
    return 'down';
  }
  return service.serversUp < service.serversTotal ? 'degraded' : 'up';
}

export const isHealthy = (service) => ['up', 'degraded'].includes(stateOf(service));

// Traefik names hold letters, digits, `-`, `_`, `.` and `@`; anything else
// would only make the external id harder to read.
export const platformIdOf = (name) => name.replace(/[^A-Za-z0-9._@-]/g, '_');

export const serviceIds = (gladys, name) => gladys.externalIds(SERVICE_TYPE, platformIdOf(name));
export const proxyIds = (gladys) => gladys.externalIds(PROXY_TYPE, PROXY_ID);

const sensor = (name, externalId, category, type, extra) => ({
  name,
  external_id: externalId,
  category,
  type,
  read_only: true,
  has_feedback: false,
  ...extra,
});

const binary = (name, externalId) =>
  sensor(name, externalId, DEVICE_FEATURE_CATEGORIES.INPUT, DEVICE_FEATURE_TYPES.SENSOR.BINARY, {
    keep_history: true,
    min: 0,
    max: 1,
  });

const counter = (name, externalId, max) =>
  sensor(
    name,
    externalId,
    DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
    DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
    { keep_history: true, min: 0, max },
  );

/** The discovery payload of the proxy. */
export function buildProxyDevice(gladys, language = 'en') {
  const ids = proxyIds(gladys);
  const names = NAMES[language] ?? NAMES.en;
  return {
    name: 'Traefik',
    external_id: ids.device,
    model: MODEL,
    should_poll: false,
    params: [],
    features: [
      binary(names[PROXY_KEYS.REACHABLE], ids.feature(PROXY_KEYS.REACHABLE)),
      sensor(
        names[PROXY_KEYS.VERSION],
        ids.feature(PROXY_KEYS.VERSION),
        DEVICE_FEATURE_CATEGORIES.TEXT,
        DEVICE_FEATURE_TYPES.TEXT.TEXT,
        { keep_history: false, min: 0, max: 0 },
      ),
      ...[
        PROXY_KEYS.ROUTERS_ERROR,
        PROXY_KEYS.SERVICES_ERROR,
        PROXY_KEYS.MIDDLEWARES_ERROR,
        PROXY_KEYS.WARNINGS,
        PROXY_KEYS.SERVICES_DOWN,
      ].map((key) => counter(names[key], ids.feature(key), MAX_COUNT)),
    ],
  };
}

/** The discovery payload of an HTTP service. */
export function buildServiceDevice(gladys, service, language = 'en') {
  const ids = serviceIds(gladys, service.name);
  const names = NAMES[language] ?? NAMES.en;
  const params = [];
  if (service.provider) {
    params.push({ name: 'PROVIDER', value: service.provider.slice(0, 255) });
  }
  return {
    name: service.name.slice(0, 255),
    external_id: ids.device,
    model: MODEL,
    should_poll: false,
    params,
    features: [
      binary(names[SERVICE_KEYS.HEALTHY], ids.feature(SERVICE_KEYS.HEALTHY)),
      counter(names[SERVICE_KEYS.SERVERS_UP], ids.feature(SERVICE_KEYS.SERVERS_UP), MAX_SERVERS),
      counter(
        names[SERVICE_KEYS.SERVERS_TOTAL],
        ids.feature(SERVICE_KEYS.SERVERS_TOTAL),
        MAX_SERVERS,
      ),
    ],
  };
}

/** The values of a service device. A missing service has no server. */
export function serviceValues(gladys, service) {
  const ids = serviceIds(gladys, service.name);
  return [
    { key: SERVICE_KEYS.HEALTHY, state: isHealthy(service) ? 1 : 0 },
    { key: SERVICE_KEYS.SERVERS_UP, state: service.present ? service.serversUp : 0 },
    { key: SERVICE_KEYS.SERVERS_TOTAL, state: service.present ? service.serversTotal : 0 },
  ].map(({ key, state }) => ({ device_feature_external_id: ids.feature(key), state }));
}

/**
 * The values of the proxy device: only "reachable" when Traefik does not
 * answer (the counts keep their last value).
 */
export function proxyValues(gladys, { reachable, version, counts, services }) {
  const ids = proxyIds(gladys);
  const values = [{ key: PROXY_KEYS.REACHABLE, state: reachable ? 1 : 0 }];
  if (reachable && counts) {
    if (version) {
      values.push({ key: PROXY_KEYS.VERSION, text: version });
    }
    values.push(
      { key: PROXY_KEYS.ROUTERS_ERROR, state: counts.routers.errors },
      { key: PROXY_KEYS.SERVICES_ERROR, state: counts.services.errors },
      { key: PROXY_KEYS.MIDDLEWARES_ERROR, state: counts.middlewares.errors },
      {
        key: PROXY_KEYS.WARNINGS,
        state: counts.routers.warnings + counts.services.warnings + counts.middlewares.warnings,
      },
      {
        key: PROXY_KEYS.SERVICES_DOWN,
        state: services.filter((service) => !isHealthy(service)).length,
      },
    );
  }
  return values.map(({ key, ...value }) => ({
    device_feature_external_id: ids.feature(key),
    ...value,
  }));
}
