import integrations, {
  hasSearchConsoleCredentials,
} from '../../../config/integrations.js';
import { getMockSearchConsoleResults } from '../../../mocks/search-console.mock.js';
import {
  buildIntegrationResponse,
  sanitizeIntegrationError,
  withTimeout,
} from '../integrationResponse.js';

function resolveDateRange(dateRange = {}) {
  if (dateRange.startDate && dateRange.endDate) {
    return {
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
    };
  }

  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - 28);

  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

/**
 * Create a Google OAuth2 access token using a service account JWT.
 * Minimal implementation without extra Google client libraries.
 */
async function getGoogleAccessToken() {
  const { clientEmail, privateKey } = integrations.searchConsole;

  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(
    JSON.stringify({ alg: 'RS256', typ: 'JWT' })
  ).toString('base64url');
  const claimSet = Buffer.from(
    JSON.stringify({
      iss: clientEmail,
      scope: 'https://www.googleapis.com/auth/webmasters.readonly',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })
  ).toString('base64url');

  const { createSign } = await import('crypto');
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claimSet}`);
  signer.end();
  const signature = signer.sign(privateKey, 'base64url');
  const assertion = `${header}.${claimSet}.${signature}`;

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  });

  const tokenResponse = await withTimeout(
    fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    }),
    integrations.timeoutMs,
    'Search Console auth'
  );

  if (!tokenResponse.ok) {
    throw new Error('Search Console authentication failed');
  }

  const tokenJson = await tokenResponse.json();
  if (!tokenJson.access_token) {
    throw new Error('Search Console access token missing');
  }

  return tokenJson.access_token;
}

async function querySearchAnalytics(accessToken, siteUrl, dateRange, dimensions) {
  const endpoint = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(
    siteUrl
  )}/searchAnalytics/query`;

  const response = await withTimeout(
    fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        dimensions,
        rowLimit: 10,
      }),
    }),
    integrations.timeoutMs,
    'Search Console'
  );

  if (response.status === 401 || response.status === 403) {
    throw new Error('Search Console site is not authorized for these credentials');
  }

  if (response.status === 429) {
    throw new Error('Search Console rate limit exceeded');
  }

  if (!response.ok) {
    throw new Error(`Search Console API unavailable (${response.status})`);
  }

  return response.json();
}

/**
 * Fetch Search Console performance metrics (mock or live).
 */
export async function analyzeSearchConsole(siteUrl, dateRange = {}) {
  const source = 'search-console';
  const range = resolveDateRange(dateRange);
  const configuredSite =
    integrations.searchConsole.siteUrl || siteUrl || null;

  if (integrations.useMocks) {
    return buildIntegrationResponse({
      source,
      success: true,
      mock: true,
      data: getMockSearchConsoleResults(configuredSite || siteUrl || 'https://example.com', range),
    });
  }

  if (!hasSearchConsoleCredentials()) {
    return buildIntegrationResponse({
      source,
      success: false,
      mock: false,
      errors: [
        'Google Search Console credentials are not configured',
      ],
    });
  }

  try {
    const accessToken = await getGoogleAccessToken();
    const site = integrations.searchConsole.siteUrl;

    const [totalsRaw, queriesRaw, pagesRaw] = await Promise.all([
      querySearchAnalytics(accessToken, site, range, []),
      querySearchAnalytics(accessToken, site, range, ['query']),
      querySearchAnalytics(accessToken, site, range, ['page']),
    ]);

    const totalRow = totalsRaw?.rows?.[0] || {};
    const clicks = totalRow.clicks || 0;
    const impressions = totalRow.impressions || 0;

    const data = {
      siteUrl: site,
      dateRange: range,
      totals: {
        clicks,
        impressions,
        ctr:
          typeof totalRow.ctr === 'number'
            ? Number(totalRow.ctr.toFixed(4))
            : impressions
              ? Number((clicks / impressions).toFixed(4))
              : 0,
        position:
          typeof totalRow.position === 'number'
            ? Number(totalRow.position.toFixed(1))
            : null,
      },
      topQueries: (queriesRaw?.rows || []).map((row) => ({
        query: row.keys?.[0],
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: row.ctr,
        position: row.position,
      })),
      topPages: (pagesRaw?.rows || []).map((row) => ({
        page: row.keys?.[0],
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: row.ctr,
        position: row.position,
      })),
    };

    return buildIntegrationResponse({
      source,
      success: true,
      mock: false,
      data,
    });
  } catch (error) {
    return buildIntegrationResponse({
      source,
      success: false,
      mock: false,
      errors: [sanitizeIntegrationError(error)],
    });
  }
}
