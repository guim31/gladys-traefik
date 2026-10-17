// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, service states, the "Test the connection"
// report, scene outputs. Four languages, the four of the Gladys interface;
// German says "du", Spanish "usted". test/i18n.test.js checks every table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './traefik/client.js';

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noUrl: {
    en: 'Enter the address of the Traefik API in the configuration.',
    fr: "Saisissez l'adresse de l'API Traefik dans la configuration.",
    de: 'Gib die Adresse der Traefik-API in der Konfiguration ein.',
    es: 'Introduzca la dirección de la API de Traefik en la configuración.',
  },
  invalidUrl: {
    en: 'Address not understood, e.g. http://192.168.1.2:8080',
    fr: 'Adresse incomprise, ex. http://192.168.1.2:8080',
    de: 'Adresse nicht verstanden, z. B. http://192.168.1.2:8080',
    es: 'Dirección no válida, p. ej. http://192.168.1.2:8080',
  },
};

// One short explanation per error kind (src/traefik/client.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'Traefik does not answer',
    fr: 'Traefik ne répond pas',
    de: 'Traefik antwortet nicht',
    es: 'Traefik no responde',
  },
  [ERROR_KINDS.TLS]: {
    en: 'certificate refused: use an http:// address or a trusted certificate',
    fr: 'certificat refusé : utilisez une adresse http:// ou un certificat reconnu',
    de: 'Zertifikat abgelehnt: Nutze eine http://-Adresse oder ein vertrauenswürdiges Zertifikat',
    es: 'certificado rechazado: use una dirección http:// o un certificado reconocido',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'user or password refused by the router of the API',
    fr: "utilisateur ou mot de passe refusé par le routeur de l'API",
    de: 'Benutzer oder Passwort vom Router der API abgelehnt',
    es: 'usuario o contraseña rechazados por el router de la API',
  },
  [ERROR_KINDS.NOT_TRAEFIK]: {
    en: 'no Traefik API at this address (is the API enabled?)',
    fr: "pas d'API Traefik à cette adresse (l'API est-elle activée ?)",
    de: 'keine Traefik-API unter dieser Adresse (ist die API aktiviert?)',
    es: 'no hay API de Traefik en esta dirección (¿está activada la API?)',
  },
  [ERROR_KINDS.REDIRECT]: {
    en: 'the address redirects: enter the https:// address',
    fr: "l'adresse redirige : saisissez l'adresse en https://",
    de: 'die Adresse leitet um: Gib die https://-Adresse ein',
    es: 'la dirección redirige: introduzca la dirección https://',
  },
  [ERROR_KINDS.HTTP]: {
    en: 'unexpected answer, see the logs',
    fr: 'réponse inattendue, voir les logs',
    de: 'unerwartete Antwort, sieh in den Protokollen nach',
    es: 'respuesta inesperada, consulte los registros',
  },
};

// The state of a service, in words (widget rows, scene outputs).
export const STATE_TEXT = {
  up: { en: 'OK', fr: 'OK', de: 'OK', es: 'OK' },
  degraded: { en: 'Degraded', fr: 'Dégradé', de: 'Eingeschränkt', es: 'Degradado' },
  down: { en: 'Down', fr: 'En panne', de: 'Ausgefallen', es: 'Caído' },
  missing: { en: 'Missing', fr: 'Absent', de: 'Fehlt', es: 'Ausente' },
};

// The "Test the connection" report and the sentences of the scene actions.
export const REPORT_TEXT = {
  en: {
    ok: 'Connected',
    services: (count) => `${count} HTTP service(s)`,
    down: (count) => `${count} down`,
    routers: (count) => `${count} router(s) in error`,
    healthy: 'everything is fine',
    unreachable: 'Traefik does not answer',
  },
  fr: {
    ok: 'Connecté',
    services: (count) => `${count} service(s) HTTP`,
    down: (count) => `${count} en panne`,
    routers: (count) => `${count} routeur(s) en erreur`,
    healthy: 'tout va bien',
    unreachable: 'Traefik ne répond pas',
  },
  de: {
    ok: 'Verbunden',
    services: (count) => `${count} HTTP-Dienst(e)`,
    down: (count) => `${count} ausgefallen`,
    routers: (count) => `${count} Router mit Fehler`,
    healthy: 'alles in Ordnung',
    unreachable: 'Traefik antwortet nicht',
  },
  es: {
    ok: 'Conectado',
    services: (count) => `${count} servicio(s) HTTP`,
    down: (count) => `${count} caído(s)`,
    routers: (count) => `${count} router(s) con error`,
    healthy: 'todo está bien',
    unreachable: 'Traefik no responde',
  },
};

// The `sentence` output of "State of a service".
export const SENTENCE_TEXT = {
  en: { servers: (up, total) => `${up}/${total} server(s) up` },
  fr: { servers: (up, total) => `${up}/${total} serveur(s) en service` },
  de: { servers: (up, total) => `${up}/${total} Server erreichbar` },
  es: { servers: (up, total) => `${up}/${total} servidor(es) activo(s)` },
};

export const ACTION_TEXT = {
  unknownService: {
    en: 'This device is not a Traefik service.',
    fr: "Cet appareil n'est pas un service Traefik.",
    de: 'Dieses Gerät ist kein Traefik-Dienst.',
    es: 'Este dispositivo no es un servicio de Traefik.',
  },
};

export const LANGUAGE_FALLBACK = 'en';

/** "Name: text", with the space French puts before a colon. */
export const labelled = (name, text, language) =>
  `${name}${language === 'fr' ? ' : ' : ': '}${text}`;
export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];
