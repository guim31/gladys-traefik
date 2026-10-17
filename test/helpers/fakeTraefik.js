// -----------------------------------------------------------------------------
// An in-memory Traefik: /api/version and /api/rawdata, starting from the real
// answers of Traefik v3.7 (test/fixtures/traefik), with the helpers the tests
// need to break things the way the Docker test did — a server DOWN, a service
// gone, a router in error, the API down or behind basic auth.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

export const BASE = 'http://192.0.2.10:8080';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/traefik/${name}`, import.meta.url), 'utf8'));

export const FIXTURES = {
  version: fixture('v3.7-version.json'),
  healthy: fixture('v3.7-rawdata-healthy.json'),
  oneDown: fixture('v3.7-rawdata-one-server-down.json'),
  serviceDown: fixture('v3.7-rawdata-service-down.json'),
};

export class FakeTraefik {
  constructor({ rawdata = FIXTURES.healthy, version = FIXTURES.version, auth = null } = {}) {
    this.rawdata = structuredClone(rawdata);
    this.version = structuredClone(version);
    /** 'user:password' required in basic auth, or null. */
    this.auth = auth;
    /** 'down': the server does not answer; a number: that HTTP status. */
    this.failure = null;
    this.requests = [];
  }

  /** Set the status of every server of an HTTP service ('UP' or 'DOWN'). */
  setServers(name, ...statuses) {
    const service = this.rawdata.services[name];
    const urls = Object.keys(service.serverStatus);
    service.serverStatus = Object.fromEntries(urls.map((url, i) => [url, statuses[i] ?? 'UP']));
  }

  removeService(name) {
    const service = this.rawdata.services[name];
    delete this.rawdata.services[name];
    return service;
  }

  setRouterError(name, error) {
    const router = this.rawdata.routers[name];
    if (error) {
      Object.assign(router, { status: 'disabled', error: [error] });
    } else {
      router.status = 'enabled';
      delete router.error;
    }
  }

  /** The request seam of src/traefik/client.js. */
  request = async (url, { headers = {} } = {}) => {
    this.requests.push({ url, headers });
    if (this.failure === 'down') {
      const error = new TypeError('fetch failed');
      error.cause = { code: 'ECONNREFUSED' };
      throw error;
    }
    if (typeof this.failure === 'number') {
      return { status: this.failure, body: '' };
    }
    if (this.auth) {
      const expected = `Basic ${Buffer.from(this.auth).toString('base64')}`;
      if (headers.authorization !== expected) {
        return { status: 401, body: '401 Unauthorized\n' };
      }
    }
    const path = url.slice(BASE.length);
    if (path === '/api/version') {
      return { status: 200, body: JSON.stringify(this.version) };
    }
    if (path === '/api/rawdata') {
      return { status: 200, body: JSON.stringify(this.rawdata) };
    }
    return { status: 404, body: '404 page not found\n' };
  };
}
