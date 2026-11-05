import env from './env.js';

const truthy = (value) =>
  String(value ?? '').trim().toLowerCase() === 'true';

/**
 * Central external SEO integration configuration.
 * USE_MOCKS=true forces deterministic mock providers (assessment / local default).
 */
const integrations = {
  useMocks: truthy(process.env.USE_MOCKS ?? 'true'),
  timeoutMs: Math.min(
    30000,
    Math.max(3000, Number(process.env.INTEGRATION_TIMEOUT_MS) || 15000)
  ),
  pagespeed: {
    apiKey: process.env.PAGESPEED_API_KEY || '',
  },
  searchConsole: {
    clientEmail: process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_EMAIL || '',
    privateKey: (process.env.GOOGLE_SEARCH_CONSOLE_PRIVATE_KEY || '').replace(
      /\\n/g,
      '\n'
    ),
    siteUrl: process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL || '',
  },
  dataForSeo: {
    login: process.env.DATAFORSEO_LOGIN || '',
    password: process.env.DATAFORSEO_PASSWORD || '',
  },
  // Keep a reference to runtime env for callers that already import env
  nodeEnv: env.nodeEnv,
};

export function hasPageSpeedCredentials() {
  return Boolean(integrations.pagespeed.apiKey);
}

export function hasSearchConsoleCredentials() {
  return Boolean(
    integrations.searchConsole.clientEmail &&
      integrations.searchConsole.privateKey &&
      integrations.searchConsole.siteUrl
  );
}

export function hasDataForSeoCredentials() {
  return Boolean(
    integrations.dataForSeo.login && integrations.dataForSeo.password
  );
}

export default integrations;
