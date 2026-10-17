// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+).
//
// "Is this service healthy?" is already a scene condition on the device
// feature. The actions are about what a condition cannot do: put the state in
// a message ("app@docker: degraded, 1/2 server(s) up"), and sum up the whole
// proxy — services down and routers in error, added to Gladys or not, or
// that Traefik does not answer. Both read Traefik again when the last read is
// older than 15 seconds. The Traefik API is read-only: nothing to command.
// -----------------------------------------------------------------------------

import { isHealthy, stateOf } from './devices.js';
import { ACTION_TEXT, REPORT_TEXT, SENTENCE_TEXT, STATE_TEXT, labelled, pick } from './texts.js';

// Names listed in the `names` output, at most (the rest is counted).
export const MAX_LISTED_NAMES = 20;

const listed = (names) => {
  const shown = names.slice(0, MAX_LISTED_NAMES);
  return names.length > shown.length
    ? `${shown.join(', ')}, +${names.length - shown.length}`
    : shown.join(', ');
};

export const SCENE_ACTIONS = {
  async get_service_status(hub, { fields = {} }) {
    if (!hub.client) {
      hub.assertReadable(); // no address: the configuration to fix
    }
    await hub.refreshIfStale();
    hub.assertReadable();
    const language = hub.config.language;
    const service = hub.find(fields.device);
    if (!service) {
      throw new Error(pick(ACTION_TEXT.unknownService, language));
    }
    const state = pick(STATE_TEXT[stateOf(service)], language);
    const words = SENTENCE_TEXT[language] ?? SENTENCE_TEXT.en;
    return {
      healthy: isHealthy(service),
      state,
      servers_up: service.serversUp,
      servers_total: service.serversTotal,
      sentence: `${labelled(service.name, state, language)}, ${words.servers(
        service.serversUp,
        service.serversTotal,
      )}.`,
    };
  },

  async get_proxy_status(hub) {
    if (!hub.client) {
      hub.assertReadable(); // no address: the configuration to fix
    }
    await hub.refreshIfStale();
    const language = hub.config.language;
    const text = REPORT_TEXT[language] ?? REPORT_TEXT.en;
    if (hub.error || !hub.reachable) {
      // "Traefik does not answer" is an answer: the scene goes on with it.
      return {
        reachable: false,
        services_down: 0,
        names: '',
        routers_error: 0,
        routers: '',
        version: hub.version,
        sentence: `${labelled('Traefik', text.unreachable, language)}.`,
      };
    }
    const down = [...hub.services.values()]
      .filter((service) => !isHealthy(service))
      .map((service) => service.name)
      .sort((a, b) => a.localeCompare(b));
    const routers = hub
      .routersInError()
      .map((router) => router.name)
      .sort((a, b) => a.localeCompare(b));
    const parts = [];
    if (down.length > 0) {
      parts.push(`${text.down(down.length)} (${listed(down)})`);
    }
    if (routers.length > 0) {
      parts.push(`${text.routers(routers.length)} (${listed(routers)})`);
    }
    return {
      reachable: true,
      services_down: down.length,
      names: listed(down),
      routers_error: routers.length,
      routers: listed(routers),
      version: hub.version,
      sentence: `${labelled('Traefik', parts.length > 0 ? parts.join(', ') : text.healthy, language)}.`,
    };
  },
};
