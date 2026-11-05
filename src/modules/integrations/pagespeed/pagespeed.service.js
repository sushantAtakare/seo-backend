import integrations, { hasPageSpeedCredentials } from '../../../config/integrations.js';
import { getMockPageSpeedBundle } from '../../../mocks/pagespeed.mock.js';
import {
  buildIntegrationResponse,
  sanitizeIntegrationError,
  withTimeout,
} from '../integrationResponse.js';

function mapPsiStrategy(url, strategy, json) {
  const lighthouse = json?.lighthouseResult || {};
  const categories = lighthouse.categories || {};
  const audits = lighthouse.audits || {};

  const scoreOf = (key) => {
    const value = categories?.[key]?.score;
    return typeof value === 'number' ? Math.round(value * 100) : null;
  };

  const numeric = (id) => {
    const v = audits?.[id]?.numericValue;
    return typeof v === 'number' ? Math.round(v) : null;
  };

  const opportunities = Object.values(audits)
    .filter((a) => a?.details?.type === 'opportunity')
    .slice(0, 5)
    .map((a) => ({
      id: a.id,
      title: a.title,
      description: a.description,
      savingsMs: a.details?.overallSavingsMs
        ? Math.round(a.details.overallSavingsMs)
        : null,
    }));

  const diagnostics = Object.values(audits)
    .filter(
      (a) =>
        a?.scoreDisplayMode === 'informative' ||
        a?.scoreDisplayMode === 'binary'
    )
    .slice(0, 5)
    .map((a) => ({
      id: a.id,
      title: a.title,
      description: a.description,
    }));

  return {
    url,
    strategy,
    scores: {
      performance: scoreOf('performance'),
      accessibility: scoreOf('accessibility'),
      bestPractices: scoreOf('best-practices'),
      seo: scoreOf('seo'),
    },
    coreWebVitals: {
      lcpMs: numeric('largest-contentful-paint'),
      cls: audits?.['cumulative-layout-shift']?.numericValue ?? null,
      inpMs: numeric('interaction-to-next-paint') ?? numeric('experimental-interaction-to-next-paint'),
      fcpMs: numeric('first-contentful-paint'),
      ttfbMs: numeric('server-response-time'),
    },
    opportunities,
    diagnostics,
  };
}

async function fetchPsiStrategy(url, strategy) {
  const endpoint = new URL(
    'https://www.googleapis.com/pagespeedonline/v5/runPagespeed'
  );
  endpoint.searchParams.set('url', url);
  endpoint.searchParams.set('strategy', strategy);
  endpoint.searchParams.set('category', 'performance');
  endpoint.searchParams.append('category', 'accessibility');
  endpoint.searchParams.append('category', 'best-practices');
  endpoint.searchParams.append('category', 'seo');
  endpoint.searchParams.set('key', integrations.pagespeed.apiKey);

  const response = await withTimeout(
    fetch(endpoint, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    }),
    integrations.timeoutMs,
    'PageSpeed'
  );

  if (response.status === 429) {
    throw new Error('PageSpeed rate limit exceeded');
  }

  if (!response.ok) {
    throw new Error(`PageSpeed API unavailable (${response.status})`);
  }

  const json = await response.json();
  return mapPsiStrategy(url, strategy, json);
}

/**
 * Analyze a URL with PageSpeed Insights (mock or live).
 */
export async function analyzePageSpeed(url) {
  const source = 'pagespeed';

  if (!url) {
    return buildIntegrationResponse({
      source,
      success: false,
      mock: integrations.useMocks,
      errors: ['URL is required for PageSpeed analysis'],
    });
  }

  if (integrations.useMocks) {
    return buildIntegrationResponse({
      source,
      success: true,
      mock: true,
      data: getMockPageSpeedBundle(url),
    });
  }

  if (!hasPageSpeedCredentials()) {
    return buildIntegrationResponse({
      source,
      success: false,
      mock: false,
      errors: ['PageSpeed API key is not configured'],
    });
  }

  try {
    const [mobile, desktop] = await Promise.all([
      fetchPsiStrategy(url, 'mobile'),
      fetchPsiStrategy(url, 'desktop'),
    ]);

    return buildIntegrationResponse({
      source,
      success: true,
      mock: false,
      data: { mobile, desktop },
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
