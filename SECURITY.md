# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- the optional **basic auth user and password** of the router serving the
  Traefik API, stored by Gladys in the integration configuration (never written
  to `/data`, never logged); they are only sent, in the `Authorization` header,
  to the address configured, and redirects are not followed so they never
  reach another host;
- the answer of `/api/rawdata`, which describes the whole Traefik
  configuration (it may include middleware settings such as basic auth
  hashes): kept in memory, only the names, statuses and error messages of the
  routers and services are used, published to Gladys or logged;
- `/data/traefik-state.json`: the address of the Traefik API, the last health
  of each HTTP service, the routers in error and since when (no secret);
- network: HTTP(S) requests to the Traefik API address, nothing else; no port
  is opened.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and Traefik itself.
