import integrations, {
  hasDataForSeoCredentials,
} from '../../../config/integrations.js';
import { getMockDataForSeoResults } from '../../../mocks/dataforseo.mock.js';
import {
  buildIntegrationResponse,
  sanitizeIntegrationError,
  withTimeout,
} from '../integrationResponse.js';

function authHeader() {
  const token = Buffer.from(
    `${integrations.dataForSeo.login}:${integrations.dataForSeo.password}`
  ).toString('base64');
  return `Basic ${token}`;
}

async function dataForSeoPost(path, payload) {
  const response = await withTimeout(
    fetch(`https://api.dataforseo.com${path}`, {
      method: 'POST',
      headers: {
        Authorization: authHeader(),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    }),
    integrations.timeoutMs,
    'DataForSEO'
  );

  if (response.status === 401 || response.status === 403) {
    throw new Error('DataForSEO authentication failed');
  }

  if (response.status === 429) {
    throw new Error('DataForSEO rate limit exceeded');
  }

  if (!response.ok) {
    throw new Error(`DataForSEO API unavailable (${response.status})`);
  }

  return response.json();
}

function mapLiveResults(domain, keyword, keywordJson, serpJson, competitorsJson) {
  const keywordTask = keywordJson?.tasks?.[0]?.result?.[0] || {};
  const serpTask = serpJson?.tasks?.[0]?.result?.[0] || {};
  const competitorTask = competitorsJson?.tasks?.[0]?.result?.[0] || {};

  return {
    domain,
    keyword,
    keywordInfo: {
      keyword,
      locationCode: keywordTask.location_code || 2840,
      languageCode: keywordTask.language_code || 'en',
      searchVolume: keywordTask.keyword_info?.search_volume ?? null,
      cpc: keywordTask.keyword_info?.cpc ?? null,
      competition: keywordTask.keyword_info?.competition ?? null,
      competitionLevel: keywordTask.keyword_info?.competition_level ?? null,
      keywordDifficulty: keywordTask.keyword_properties?.keyword_difficulty ?? null,
    },
    serp: {
      keyword,
      seResultsCount: serpTask.se_results_count ?? null,
      items: (serpTask.items || [])
        .filter((item) => item.type === 'organic')
        .slice(0, 10)
        .map((item) => ({
          rankGroup: item.rank_group,
          rankAbsolute: item.rank_absolute,
          domain: item.domain,
          url: item.url,
          title: item.title,
        })),
    },
    competitors: (competitorTask.items || []).slice(0, 10).map((item) => ({
      domain: item.domain,
      avgPosition: item.avg_position,
      intersections: item.intersections,
      visibility: item.visibility,
    })),
  };
}

/**
 * Fetch keyword / SERP / competitor insights (mock or live).
 */
export async function analyzeDataForSeo(domain, options = {}) {
  const source = 'dataforseo';
  const safeDomain = String(domain || '')
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '')
    .toLowerCase();

  if (!safeDomain) {
    return buildIntegrationResponse({
      source,
      success: false,
      mock: integrations.useMocks,
      errors: ['Domain is required for DataForSEO analysis'],
    });
  }

  const keyword =
    options.keyword || `${safeDomain.split('.')[0] || safeDomain} seo`;

  if (integrations.useMocks) {
    return buildIntegrationResponse({
      source,
      success: true,
      mock: true,
      data: getMockDataForSeoResults(safeDomain, keyword),
    });
  }

  if (!hasDataForSeoCredentials()) {
    return buildIntegrationResponse({
      source,
      success: false,
      mock: false,
      errors: ['DataForSEO credentials are not configured'],
    });
  }

  try {
    const [keywordJson, serpJson, competitorsJson] = await Promise.all([
      dataForSeoPost('/v3/dataforseo_labs/google/keyword_overview/live', [
        {
          keywords: [keyword],
          location_code: 2840,
          language_code: 'en',
        },
      ]),
      dataForSeoPost('/v3/serp/google/organic/live/regular', [
        {
          keyword,
          location_code: 2840,
          language_code: 'en',
          depth: 10,
        },
      ]),
      dataForSeoPost('/v3/dataforseo_labs/google/competitors_domain/live', [
        {
          target: safeDomain,
          location_code: 2840,
          language_code: 'en',
          limit: 10,
        },
      ]),
    ]);

    return buildIntegrationResponse({
      source,
      success: true,
      mock: false,
      data: mapLiveResults(
        safeDomain,
        keyword,
        keywordJson,
        serpJson,
        competitorsJson
      ),
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
