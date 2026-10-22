# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.1] - 2026-10-22

### Security

- Rebuilt on Node.js 24.22.1, the October 2026 security release (remote code
  execution in the Brotli decoder, CVE-2026-111497; TLS hostname and DNS
  fixes).

## [1.0.0] - 2026-10-17

### Added

- A Traefik device: reachable, version, routers, services and middlewares in
  error, warnings, HTTP services down.
- One device per HTTP service of Traefik: healthy, servers up and in total,
  from the health checks of Traefik. A service gone from Traefik (a Docker
  container stopped) counts as down.
- Scene triggers: a service goes down, a service is back up (with the outage
  length), a router is in error, Traefik is unreachable.
- Scene actions: state of a service and state of Traefik, with a ready-made
  sentence.
- A dashboard widget: services down first, routers in error, a Refresh button.
- Basic auth for an API served through a router, and a "Test the connection"
  action.
- Texts and documentation in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-traefik/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/guim31/gladys-traefik/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/guim31/gladys-traefik/releases/tag/v1.0.0
