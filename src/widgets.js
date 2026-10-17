// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `traefik`.
//
// The use case: a glance at the wall tablet tells whether the self-hosted
// services behind Traefik answer, and which one does not. So the widget shows
// the services down, the routers in error and the services working, then one
// row per service — down first, then degraded, then the others — with its
// servers up, and the routers in error with their message.
//
// Every HTTP service by default, or the ones chosen in the widget settings
// (devices added to Gladys). The figures are sent as values, not bound to
// device features: the widget works before the devices are added.
//
// Budget (8 components, 2 texts): three tiles, one text when Traefik does not
// answer, two status lists (services, routers in error), a Refresh button.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { stateOf } from './devices.js';
import { WIDGET_KEY } from './hub.js';
import { ERROR_TEXT, STATE_TEXT, pick } from './texts.js';

// Action key of the button: permanent once published.
export const ACTIONS = Object.freeze({ REFRESH: 'refresh' });

export const MAX_ROWS = 10;
export const MAX_ROUTER_ROWS = 5;

export const TEXT = {
  pick: {
    en: 'Enter the address of the Traefik API in the configuration of the integration.',
    fr: "Saisissez l'adresse de l'API Traefik dans la configuration de l'intégration.",
    de: 'Gib die Adresse der Traefik-API in der Konfiguration der Integration ein.',
    es: 'Introduzca la dirección de la API de Traefik en la configuración de la integración.',
  },
  empty: {
    en: 'No HTTP service with servers in Traefik yet.',
    fr: 'Aucun service HTTP avec des serveurs dans Traefik pour le moment.',
    de: 'Noch kein HTTP-Dienst mit Servern in Traefik.',
    es: 'Todavía no hay ningún servicio HTTP con servidores en Traefik.',
  },
  down: { en: 'Down', fr: 'En panne', de: 'Ausgefallen', es: 'Caídos' },
  routers: { en: 'Router errors', fr: 'Routeurs KO', de: 'Router-Fehler', es: 'Routers KO' },
  up: { en: 'Working', fr: 'En service', de: 'In Betrieb', es: 'En servicio' },
  more: { en: 'Others', fr: 'Autres', de: 'Weitere', es: 'Otros' },
  refresh: { en: 'Refresh', fr: 'Actualiser', de: 'Aktualisieren', es: 'Actualizar' },
  refreshed: {
    en: 'Traefik read again.',
    fr: 'Traefik relu.',
    de: 'Traefik neu gelesen.',
    es: 'Traefik leído de nuevo.',
  },
};

// Row order: what needs attention first.
const SEVERITY = ['down', 'missing', 'degraded', 'up'];

const ROW_STYLE = {
  down: { icon: 'x-circle', color: WIDGET_COLORS.DANGER },
  missing: { icon: 'help-circle', color: WIDGET_COLORS.DANGER },
  degraded: { icon: 'alert-triangle', color: WIDGET_COLORS.WARNING },
  up: { icon: 'check-circle', color: WIDGET_COLORS.SUCCESS },
};

const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

function message(text, language) {
  return {
    ttl_seconds: 300,
    components: [{ type: 'text', variant: 'body', text: pick(text, language) }],
  };
}

/** The services the widget shows: the chosen devices, or every service. */
export function selectServices(hub, settings) {
  const chosen = [settings?.services ?? []].flat().filter((id) => typeof id === 'string' && id);
  if (chosen.length === 0) {
    return [...hub.services.values()];
  }
  return [...new Set(chosen)].map((id) => hub.find(id)).filter(Boolean);
}

export function sortServices(services) {
  return [...services].sort(
    (a, b) =>
      SEVERITY.indexOf(stateOf(a)) - SEVERITY.indexOf(stateOf(b)) || a.name.localeCompare(b.name),
  );
}

function rowValue(service, language) {
  const state = stateOf(service);
  const text = pick(STATE_TEXT[state], language);
  return state === 'missing' ? text : `${text} · ${service.serversUp}/${service.serversTotal}`;
}

async function get(hub, { settings, language = 'en' }) {
  if (!hub.client) {
    return message(TEXT.pick, language);
  }
  const services = sortServices(selectServices(hub, settings));
  const routers = hub.routersInError();
  if (services.length === 0 && routers.length === 0 && !hub.error) {
    return message(TEXT.empty, language);
  }

  const down = services.filter((service) => ['down', 'missing'].includes(stateOf(service))).length;
  const components = [
    {
      type: 'value',
      value: down,
      label: pick(TEXT.down, language),
      icon: 'x-circle',
      color: down > 0 ? WIDGET_COLORS.DANGER : WIDGET_COLORS.NEUTRAL,
    },
    {
      type: 'value',
      value: routers.length,
      label: pick(TEXT.routers, language),
      icon: 'alert-octagon',
      color: routers.length > 0 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
    },
    {
      type: 'value',
      value: services.length - down,
      label: pick(TEXT.up, language),
      icon: 'check-circle',
      color: WIDGET_COLORS.SUCCESS,
    },
  ];

  if (hub.error) {
    components.push({
      type: 'text',
      variant: 'body',
      text: pick(ERROR_TEXT[hub.error.kind], language),
    });
  }

  if (services.length > 0) {
    const shown = services.length > MAX_ROWS ? services.slice(0, MAX_ROWS - 1) : services;
    const items = shown.map((service) => ({
      label: fit(service.name, 40),
      value: fit(rowValue(service, language), 40),
      ...ROW_STYLE[stateOf(service)],
    }));
    if (services.length > shown.length) {
      items.push({
        label: pick(TEXT.more, language),
        value: `+${services.length - shown.length}`,
        icon: 'more-horizontal',
        color: WIDGET_COLORS.NEUTRAL,
      });
    }
    components.push({ type: 'status', items });
  }

  if (routers.length > 0) {
    const shown =
      routers.length > MAX_ROUTER_ROWS ? routers.slice(0, MAX_ROUTER_ROWS - 1) : routers;
    const items = shown.map((router) => ({
      label: fit(router.name, 40),
      value: fit(router.errors[0] ?? '-', 40),
      icon: 'alert-octagon',
      color: WIDGET_COLORS.WARNING,
    }));
    if (routers.length > shown.length) {
      items.push({
        label: pick(TEXT.more, language),
        value: `+${routers.length - shown.length}`,
        icon: 'more-horizontal',
        color: WIDGET_COLORS.NEUTRAL,
      });
    }
    components.push({ type: 'status', items });
  }

  components.push({
    type: 'button',
    label: pick(TEXT.refresh, language),
    icon: 'refresh-cw',
    style: 'secondary',
    action: { key: ACTIONS.REFRESH },
  });

  // Something broken moves: refresh sooner.
  const moving = hub.error || down > 0 || services.some((s) => stateOf(s) === 'degraded');
  return { ttl_seconds: moving ? 30 : 60, components };
}

async function action(hub, { actionKey }) {
  if (actionKey !== ACTIONS.REFRESH) {
    throw new Error(`Unknown action ${actionKey}`);
  }
  await hub.pollNow();
  if (hub.error) {
    return { message: ERROR_TEXT[hub.error.kind] };
  }
  return { message: TEXT.refreshed };
}

export const WIDGETS = {
  [WIDGET_KEY]: { get, action },
};
