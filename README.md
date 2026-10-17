# Traefik for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com)
that brings the state of a [Traefik](https://traefik.io/traefik/) reverse
proxy into Gladys: which self-hosted services answer, which routers are
broken, and whether Traefik itself is up.

- **A Traefik device**: reachable, version, routers, services and middlewares
  in error, warnings, HTTP services down.
- **One device per HTTP service** (`nextcloud@docker`…): healthy, servers up,
  servers in total — from the health checks of Traefik.
- **Scene triggers**: a service goes down (or disappears), is back up (with
  the outage length), a router turns to error, Traefik is unreachable — for
  any service, added to Gladys or not.
- **Scene actions**: state of a service and state of Traefik, each with a
  ready-made sentence.
- **Dashboard widget**: services down first, then degraded, then the others,
  and the routers in error with their message.
- Texts in English, French, German and Spanish.

Tested against a real Traefik v3.7 (Docker, file provider, two
`traefik/whoami` backends behind a health check, broken routers on purpose,
basic auth). Traefik v2 has the same API but was not tested: feedback welcome
on [the issues](https://github.com/guim31/gladys-traefik/issues).

## Requirements

- Gladys Assistant 5.1.0 or later.
- Traefik v2 or v3 with its API enabled (`api.insecure=true` on port 8080, or
  a router to `api@internal`, optionally behind basic auth), reachable from
  the Gladys machine.
- A health check on the load balancers whose servers should be watched:
  without one, Traefik reports every server UP.

## Installation

In Gladys, open **Integrations → Install from GitHub** and enter
`https://github.com/guim31/gladys-traefik`. Then open its configuration, enter
the address of the API (and the basic auth user and password if any), and add
the devices from the Discover tab.

The full guide: [docs/en.md](docs/en.md) (also in [French](docs/fr.md),
[German](docs/de.md) and [Spanish](docs/es.md)).

## How it works

The container reads `GET /api/version` and `GET /api/rawdata` at the chosen
interval (every minute by default): `rawdata` holds every router, service and
middleware with its runtime status, errors and server states, in one request.
It publishes the states of the devices added to Gladys when they change, and
fires the scene events on the transitions. The last health of each service,
the routers in error and the reachability of Traefik are kept in `/data`, so a
change during a restart is announced once. Redirects are not followed, so the
basic auth credentials never reach another host.

## Limits

- Read-only: the Traefik API cannot change anything.
- HTTP services only as devices; TCP and UDP are counted on the Traefik device.
- The Prometheus metrics (request rates, 5xx) are not read.
- A self-signed HTTPS certificate is not accepted (use `http://` on the local
  network).

## Development

```bash
npm ci
npm run format:check && npm run lint && npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

See [CLAUDE.md](CLAUDE.md) for the project rules and the notes on the Traefik
API.

## Credits

- [Traefik](https://github.com/traefik/traefik) by Traefik Labs and
  contributors (MIT): the API answers in `test/fixtures/traefik` come from its
  official Docker image, with
  [traefik/whoami](https://github.com/traefik/whoami) (Apache-2.0) as backend.
- Built from the official
  [Gladys integration template](https://github.com/GladysAssistant/integration-template-js)
  and on the architecture of
  [gladys-healthchecks](https://github.com/guim31/gladys-healthchecks).

Not affiliated with Traefik Labs.

## License

Apache-2.0, see [LICENSE](LICENSE).
