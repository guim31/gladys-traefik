// -----------------------------------------------------------------------------
// Traefik client: the read-only API of Traefik v2 and v3 (same routes), served
// by `api@internal` — on the `traefik` entry point with `api.insecure=true`
// (port 8080), or through a router of the user, often behind basic auth.
//
//   GET /api/version   { Version, Codename, startDate }
//   GET /api/rawdata   every router, service and middleware (HTTP, TCP, UDP)
//                      with its runtime `status` (enabled, warning, disabled),
//                      `error` list and, for a load balancer, `serverStatus`
//                      (UP or DOWN per server; DOWN needs a health check)
//
// One read is these two requests: /api/rawdata holds what /api/overview,
// /api/http/* and the others hold, without pagination.
//
// Redirects are not followed: the basic auth credentials would be sent to
// wherever the address points (an http:// address redirected to https:// is
// reported instead).
// -----------------------------------------------------------------------------

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable', // no answer: down, wrong address, firewall
  TLS: 'tls', // the certificate does not verify
  AUTH: 'auth', // basic auth refused (or missing)
  NOT_TRAEFIK: 'not_traefik', // something answers, not the Traefik API
  REDIRECT: 'redirect', // the address redirects (usually HTTP to HTTPS)
  HTTP: 'http', // any other HTTP error
});

export class TraefikError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message English, for the logs (never contains a secret)
   * @param {object} [extra] { status }
   */
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = 'TraefikError';
    this.kind = kind;
    Object.assign(this, extra);
  }
}

const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

// A large Kubernetes cluster can have a few thousand routers: some MB at most.
export const MAX_BODY_BYTES = 16 * 1024 * 1024;

/**
 * The one function that talks to the network (fetch). The client takes it as
 * a parameter: the tests replace it with an in-memory Traefik
 * (test/helpers/fakeTraefik.js).
 * @returns {Promise<{ status: number, body: string }>}
 */
export async function httpRequest(url, { headers = {}, timeoutMs = 10_000 } = {}) {
  const response = await fetch(url, {
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > MAX_BODY_BYTES) {
    await response.body?.cancel();
    throw new Error('Response too large');
  }
  return { status: response.status, body: await response.text() };
}

const STATUSES = new Set(['enabled', 'warning', 'disabled']);
const PROTOCOLS = [
  { protocol: 'http', routers: 'routers', services: 'services', middlewares: 'middlewares' },
  {
    protocol: 'tcp',
    routers: 'tcpRouters',
    services: 'tcpServices',
    middlewares: 'tcpMiddlewares',
  },
  { protocol: 'udp', routers: 'udpRouters', services: 'udpServices', middlewares: null },
];

const statusOf = (raw) => (STATUSES.has(raw?.status) ? raw.status : 'enabled');

const errorsOf = (raw) =>
  (Array.isArray(raw?.error) ? raw.error : [])
    .filter((text) => typeof text === 'string' && text.trim())
    .map((text) => text.trim());

/** `name@provider` → provider (`file`, `docker`, `internal`…). */
export const providerOf = (name) =>
  name.includes('@') ? name.slice(name.lastIndexOf('@') + 1) : '';

const entries = (table) =>
  table && typeof table === 'object' && !Array.isArray(table)
    ? Object.entries(table).filter(([name, item]) => name && item && typeof item === 'object')
    : [];

/**
 * An HTTP load balancer service: its servers and how many are UP. A server
 * missing from `serverStatus` counts as up — Traefik only lists them once the
 * service is built; a service in error (disabled) has no server up.
 */
function normalizeService(name, raw) {
  const status = statusOf(raw);
  const servers = Array.isArray(raw.loadBalancer?.servers) ? raw.loadBalancer.servers : [];
  const addresses = servers
    .map((server) => server?.url ?? server?.address)
    .filter((address) => typeof address === 'string');
  const serverStatus =
    raw.serverStatus && typeof raw.serverStatus === 'object' ? raw.serverStatus : {};
  const total = Math.max(addresses.length, Object.keys(serverStatus).length);
  const down = Object.values(serverStatus).filter((value) => value !== 'UP').length;
  return {
    name,
    provider: providerOf(name),
    status,
    errors: errorsOf(raw),
    serversTotal: total,
    serversUp: status === 'disabled' ? 0 : Math.max(0, total - down),
    healthCheck: Boolean(raw.loadBalancer?.healthCheck),
  };
}

/**
 * The answer of /api/rawdata, normalized.
 * @returns {{ services: object[], routers: object[], counts: object }}
 *   services: the HTTP load balancers (not `@internal`), routers: every
 *   router (HTTP, TCP, UDP) with its status and errors, counts: errors and
 *   warnings per kind, as the dashboard overview counts them.
 */
export function normalizeRawData(data) {
  const counts = {
    routers: { errors: 0, warnings: 0, total: 0 },
    services: { errors: 0, warnings: 0, total: 0 },
    middlewares: { errors: 0, warnings: 0, total: 0 },
  };
  const count = (kind, raw) => {
    const status = statusOf(raw);
    counts[kind].total += 1;
    if (status === 'disabled') {
      counts[kind].errors += 1;
    } else if (status === 'warning') {
      counts[kind].warnings += 1;
    }
  };
  const routers = [];
  const services = [];
  for (const keys of PROTOCOLS) {
    for (const [name, raw] of entries(data[keys.routers])) {
      count('routers', raw);
      routers.push({
        name,
        protocol: keys.protocol,
        provider: providerOf(name),
        status: statusOf(raw),
        errors: errorsOf(raw),
      });
    }
    for (const [name, raw] of entries(data[keys.services])) {
      count('services', raw);
      if (keys.protocol === 'http' && raw.loadBalancer && providerOf(name) !== 'internal') {
        services.push(normalizeService(name, raw));
      }
    }
    for (const [name, raw] of keys.middlewares ? entries(data[keys.middlewares]) : []) {
      void name;
      count('middlewares', raw);
    }
  }
  return { services, routers, counts };
}

export class TraefikClient {
  /**
   * @param {object} options
   * @param {string} options.url base URL, `http(s)://host[:port][/path]`
   * @param {string} [options.username] basic auth, when the API is behind a router
   * @param {string} [options.password]
   * @param {typeof httpRequest} [options.request] test seam
   * @param {number} [options.timeoutMs]
   */
  constructor({ url, username = '', password = '', request = httpRequest, timeoutMs = 10_000 }) {
    this.url = url;
    this.headers = { accept: 'application/json' };
    if (username) {
      const token = Buffer.from(`${username}:${password}`, 'utf8').toString('base64');
      this.headers.authorization = `Basic ${token}`;
    }
    this.request = request;
    this.timeoutMs = timeoutMs;
  }

  async get(path) {
    let response;
    try {
      response = await this.request(`${this.url}${path}`, {
        headers: this.headers,
        timeoutMs: this.timeoutMs,
      });
    } catch (err) {
      const code = err.cause?.code ?? err.code;
      if (TLS_CODES.has(code)) {
        throw new TraefikError(ERROR_KINDS.TLS, `Certificate refused (${code})`);
      }
      throw new TraefikError(ERROR_KINDS.UNREACHABLE, code ?? err.name ?? err.message);
    }
    const { status } = response;
    if (status === 401 || status === 403) {
      throw new TraefikError(ERROR_KINDS.AUTH, `Credentials refused (HTTP ${status})`, { status });
    }
    if (status >= 300 && status < 400) {
      throw new TraefikError(ERROR_KINDS.REDIRECT, `Redirected (HTTP ${status})`, { status });
    }
    if (status === 404) {
      throw new TraefikError(ERROR_KINDS.NOT_TRAEFIK, `No Traefik API at this address (HTTP 404)`, {
        status,
      });
    }
    if (status < 200 || status >= 300) {
      throw new TraefikError(ERROR_KINDS.HTTP, `Unexpected answer (HTTP ${status})`, { status });
    }
    try {
      const data = JSON.parse(response.body);
      if (data && typeof data === 'object' && !Array.isArray(data)) {
        return data;
      }
    } catch {
      // reported below
    }
    throw new TraefikError(ERROR_KINDS.NOT_TRAEFIK, `The answer of ${path} is not Traefik JSON`);
  }

  /**
   * One read of Traefik.
   * @returns {Promise<{ version: string, services: object[], routers: object[], counts: object }>}
   * @throws {TraefikError}
   */
  async snapshot() {
    const version = await this.get('/api/version');
    if (typeof version.Version !== 'string') {
      throw new TraefikError(ERROR_KINDS.NOT_TRAEFIK, 'The answer is not the Traefik version');
    }
    const rawdata = await this.get('/api/rawdata');
    return { version: version.Version.slice(0, 40), ...normalizeRawData(rawdata) };
  }
}
