import dns from 'dns/promises';
import net from 'net';
import { load } from 'cheerio';
import ApiError from '../../utils/ApiError.js';

export const CRAWLER_USER_AGENT =
  'SEOAutomationBot/1.0 (+https://seo-automation.local; audit-crawler)';

export const CRAWLER_LIMITS = {
  maxPagesDefault: 5,
  maxPagesHard: 20,
  maxDepthDefault: 1,
  maxDepthHard: 3,
  timeoutMsDefault: 8000,
  timeoutMsHard: 15000,
  maxResponseBytes: 1_500_000,
  maxRedirects: 5,
  overallTimeoutMsDefault: 25000,
  overallTimeoutMsHard: 45000,
};

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata',
]);

/**
 * Normalize URL: absolute http(s), strip hash, drop default ports, trailing slash consistency for paths.
 */
export function normalizeUrl(rawUrl, baseUrl) {
  let parsed;

  try {
    parsed = baseUrl ? new URL(rawUrl, baseUrl) : new URL(rawUrl);
  } catch {
    return null;
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return null;
  }

  parsed.hash = '';

  if (
    (parsed.protocol === 'http:' && parsed.port === '80') ||
    (parsed.protocol === 'https:' && parsed.port === '443')
  ) {
    parsed.port = '';
  }

  // Normalize pathname empty -> /
  if (!parsed.pathname) {
    parsed.pathname = '/';
  }

  return parsed.toString();
}

export function getRegistrableHost(hostname) {
  return String(hostname || '')
    .trim()
    .toLowerCase()
    .replace(/\.$/, '');
}

export function isSameDomain(urlA, urlB) {
  try {
    const a = new URL(urlA);
    const b = new URL(urlB);
    return getRegistrableHost(a.hostname) === getRegistrableHost(b.hostname);
  } catch {
    return false;
  }
}

export function isLoopbackIpAddress(ip) {
  const value = String(ip || '').trim().toLowerCase();

  if (!value) return false;
  if (value === '::1' || value === '0:0:0:0:0:0:0:1') return true;
  if (value.startsWith('::ffff:')) return isLoopbackIpAddress(value.slice(7));
  if (net.isIPv4(value)) return value.startsWith('127.');
  return false;
}

export function isPrivateIpAddress(ip) {
  const value = String(ip || '').trim().toLowerCase();

  if (!value) {
    return true;
  }

  if (isLoopbackIpAddress(value)) {
    return true;
  }

  // IPv4-mapped IPv6
  if (value.startsWith('::ffff:')) {
    return isPrivateIpAddress(value.slice(7));
  }

  if (net.isIPv4(value)) {
    const parts = value.split('.').map(Number);
    const [a, b] = parts;

    if (a === 10) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast / reserved
    return false;
  }

  if (net.isIPv6(value)) {
    if (value === '::' || value === '::0') return true;
    if (value.startsWith('fc') || value.startsWith('fd')) return true; // unique local
    if (value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb')) {
      return true; // link-local
    }
    return false;
  }

  return true;
}

function assertHostnameNotBlocked(hostname) {
  const host = getRegistrableHost(hostname);

  if (!host) {
    throw new ApiError(400, 'Target URL is not allowed');
  }

  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith('.localhost') || host.endsWith('.local')) {
    throw new ApiError(400, 'Target URL is not allowed');
  }

  // Literal IP in hostname
  if (net.isIP(host) && isPrivateIpAddress(host)) {
    throw new ApiError(400, 'Target URL is not allowed');
  }
}

/**
 * Validate protocol + resolve DNS and reject private destinations.
 */
export async function assertSafePublicUrl(rawUrl, { allowPrivateNetworks = false } = {}) {
  let parsed;

  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new ApiError(400, 'Invalid URL');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new ApiError(400, 'Only HTTP and HTTPS URLs are supported');
  }

  if (parsed.username || parsed.password) {
    throw new ApiError(400, 'Target URL is not allowed');
  }

  const hostname = getRegistrableHost(parsed.hostname);

  // Test/fixture mode: allow ONLY loopback destinations, never cloud metadata / LAN ranges
  if (allowPrivateNetworks) {
    if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
      return parsed;
    }

    if (net.isIP(hostname)) {
      if (!isLoopbackIpAddress(hostname)) {
        throw new ApiError(400, 'Target URL is not allowed');
      }
      return parsed;
    }

    let loopbackRecords;
    try {
      loopbackRecords = await dns.lookup(hostname, { all: true, verbatim: true });
    } catch {
      throw new ApiError(400, 'Unable to resolve target host');
    }

    if (
      !loopbackRecords.length ||
      loopbackRecords.some((record) => !isLoopbackIpAddress(record.address))
    ) {
      throw new ApiError(400, 'Target URL is not allowed');
    }

    return parsed;
  }

  assertHostnameNotBlocked(parsed.hostname);

  if (net.isIP(hostname)) {
    if (isPrivateIpAddress(hostname)) {
      throw new ApiError(400, 'Target URL is not allowed');
    }
    return parsed;
  }

  let records;

  try {
    records = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new ApiError(400, 'Unable to resolve target host');
  }

  if (!records.length) {
    throw new ApiError(400, 'Unable to resolve target host');
  }

  for (const record of records) {
    if (isPrivateIpAddress(record.address)) {
      throw new ApiError(400, 'Target URL is not allowed');
    }
  }

  return parsed;
}

export function parseRobotsTxt(content, userAgent = CRAWLER_USER_AGENT) {
  const lines = String(content || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, '').trim())
    .filter(Boolean);

  const groups = [];
  let current = null;

  for (const line of lines) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;

    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (key === 'user-agent') {
      current = { agents: [value.toLowerCase()], allow: [], disallow: [] };
      groups.push(current);
      continue;
    }

    if (!current) continue;

    if (key === 'allow') current.allow.push(value);
    if (key === 'disallow') current.disallow.push(value);
  }

  const ua = userAgent.toLowerCase();
  const matched =
    groups.find((g) => g.agents.some((a) => a !== '*' && ua.includes(a))) ||
    groups.find((g) => g.agents.includes('*')) ||
    { allow: [], disallow: [] };

  return matched;
}

export function isPathAllowedByRobots(pathname, robotsRules) {
  const path = pathname || '/';
  const disallow = robotsRules?.disallow || [];
  const allow = robotsRules?.allow || [];

  const matchingDisallow = disallow
    .filter((rule) => rule && path.startsWith(rule))
    .sort((a, b) => b.length - a.length)[0];

  const matchingAllow = allow
    .filter((rule) => rule && path.startsWith(rule))
    .sort((a, b) => b.length - a.length)[0];

  if (!matchingDisallow) {
    return true;
  }

  if (matchingAllow && matchingAllow.length >= matchingDisallow.length) {
    return true;
  }

  // "Disallow:" empty means allow all
  if (matchingDisallow === '') {
    return true;
  }

  return false;
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

/**
 * Extract SEO signals from an HTML document.
 */
export function extractPageSeo(html, pageUrl) {
  const $ = load(html);
  const title = ($('title').first().text() || '').trim();
  const metaDescription = (
    $('meta[name="description"]').attr('content') ||
    $('meta[property="og:description"]').attr('content') ||
    ''
  ).trim();
  const metaKeywords = ($('meta[name="keywords"]').attr('content') || '').trim();
  const canonical = normalizeUrl(
    $('link[rel="canonical"]').attr('href') || '',
    pageUrl
  );
  const robotsMeta = (
    $('meta[name="robots"]').attr('content') ||
    $('meta[name="googlebot"]').attr('content') ||
    ''
  ).trim();
  const language =
    $('html').attr('lang') ||
    $('meta[http-equiv="content-language"]').attr('content') ||
    null;

  const headings = {
    h1: [],
    h2: [],
    h3: [],
    h4: [],
    h5: [],
    h6: [],
  };

  for (const level of Object.keys(headings)) {
    $(level).each((_, el) => {
      const text = $(el).text().replace(/\s+/g, ' ').trim();
      if (text) headings[level].push(text);
    });
  }

  const internalLinks = [];
  const externalLinks = [];

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    const normalized = normalizeUrl(href, pageUrl);
    if (!normalized) return;

    if (isSameDomain(normalized, pageUrl)) {
      internalLinks.push(normalized);
    } else {
      externalLinks.push(normalized);
    }
  });

  const images = [];
  const imagesMissingAlt = [];

  $('img').each((_, el) => {
    const src = normalizeUrl($(el).attr('src') || '', pageUrl);
    const alt = $(el).attr('alt');
    const image = {
      src: src || $(el).attr('src') || null,
      alt: alt === undefined ? null : alt,
      missingAlt: alt === undefined || String(alt).trim() === '',
    };
    images.push(image);
    if (image.missingAlt) {
      imagesMissingAlt.push(image);
    }
  });

  const jsonLdBlocks = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    if (raw && raw.trim()) {
      jsonLdBlocks.push(raw.trim());
    }
  });

  return {
    url: pageUrl,
    title: title || null,
    metaDescription: metaDescription || null,
    metaKeywords: metaKeywords || null,
    canonical,
    robotsMeta: robotsMeta || null,
    language: language ? String(language).trim() : null,
    headings,
    internalLinks: uniqueStrings(internalLinks),
    externalLinks: uniqueStrings(externalLinks),
    images,
    imagesMissingAlt,
    jsonLdBlocks,
    missingTitle: !title,
    missingMetaDescription: !metaDescription,
    missingH1: headings.h1.length === 0,
    multipleH1: headings.h1.length > 1,
  };
}

export function detectDuplicateSignals(pages) {
  const titleMap = new Map();
  const h1Map = new Map();

  for (const page of pages) {
    if (page.title) {
      const key = page.title.toLowerCase();
      if (!titleMap.has(key)) titleMap.set(key, []);
      titleMap.get(key).push(page.url);
    }

    for (const h1 of page.headings?.h1 || []) {
      const key = h1.toLowerCase();
      if (!h1Map.has(key)) h1Map.set(key, []);
      h1Map.get(key).push(page.url);
    }
  }

  const duplicateTitles = [...titleMap.entries()]
    .filter(([, urls]) => urls.length > 1)
    .map(([title, urls]) => ({ title, urls }));

  const duplicateH1s = [...h1Map.entries()]
    .filter(([, urls]) => urls.length > 1)
    .map(([h1, urls]) => ({ h1, urls }));

  return { duplicateTitles, duplicateH1s };
}

export function buildIssueSets(pages, duplicates) {
  const criticalIssues = [];
  const importantIssues = [];
  const warnings = [];
  const passedChecks = [];

  for (const page of pages) {
    if (page.missingTitle) {
      criticalIssues.push({
        code: 'MISSING_TITLE',
        message: 'Page is missing a title tag',
        url: page.url,
      });
    }

    if (page.missingH1) {
      criticalIssues.push({
        code: 'MISSING_H1',
        message: 'Page is missing an H1 heading',
        url: page.url,
      });
    }

    if (page.missingMetaDescription) {
      importantIssues.push({
        code: 'MISSING_META_DESCRIPTION',
        message: 'Page is missing a meta description',
        url: page.url,
      });
    }

    if (page.imagesMissingAlt?.length) {
      importantIssues.push({
        code: 'IMAGES_MISSING_ALT',
        message: `${page.imagesMissingAlt.length} image(s) missing alt text`,
        url: page.url,
        count: page.imagesMissingAlt.length,
      });
    }

    if (page.multipleH1) {
      warnings.push({
        code: 'MULTIPLE_H1',
        message: 'Page has multiple H1 headings',
        url: page.url,
        count: page.headings.h1.length,
      });
    }

    if (page.statusCode && page.statusCode >= 400) {
      criticalIssues.push({
        code: 'HTTP_ERROR',
        message: `Page returned HTTP ${page.statusCode}`,
        url: page.url,
        statusCode: page.statusCode,
      });
    }

    if (!page.missingTitle) {
      passedChecks.push({ code: 'HAS_TITLE', url: page.url });
    }
    if (!page.missingMetaDescription) {
      passedChecks.push({ code: 'HAS_META_DESCRIPTION', url: page.url });
    }
    if (!page.missingH1) {
      passedChecks.push({ code: 'HAS_H1', url: page.url });
    }
  }

  for (const dup of duplicates.duplicateTitles) {
    warnings.push({
      code: 'DUPLICATE_TITLE',
      message: `Duplicate title across ${dup.urls.length} pages`,
      title: dup.title,
      urls: dup.urls,
    });
  }

  for (const dup of duplicates.duplicateH1s) {
    warnings.push({
      code: 'DUPLICATE_H1',
      message: `Duplicate H1 across ${dup.urls.length} pages`,
      h1: dup.h1,
      urls: dup.urls,
    });
  }

  return { criticalIssues, importantIssues, warnings, passedChecks };
}

export function scoreFromIssues({ criticalIssues, importantIssues, warnings }) {
  const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));

  const criticalPenalty = criticalIssues.length * 15;
  const importantPenalty = importantIssues.length * 8;
  const warningPenalty = warnings.length * 3;

  const onPageSeo = clamp(100 - criticalPenalty - importantPenalty - warningPenalty);
  const technicalSeo = clamp(
    100 -
      criticalIssues.filter((i) => i.code === 'HTTP_ERROR').length * 20 -
      warnings.filter((i) => i.code === 'DUPLICATE_TITLE').length * 5
  );
  const contentQuality = clamp(
    100 -
      criticalIssues.filter((i) => i.code === 'MISSING_H1').length * 20 -
      importantIssues.filter((i) => i.code === 'IMAGES_MISSING_ALT').length * 10
  );

  // Placeholder dimensions until dedicated integrations exist
  const performance = clamp(100 - Math.min(40, pagesLoadPenalty(criticalIssues, importantIssues)));
  const mobileFriendliness = 70;
  const schemaMarkup = 50;

  const overallScore = clamp(
    (technicalSeo + onPageSeo + performance + mobileFriendliness + contentQuality + schemaMarkup) /
      6
  );

  return {
    technicalSeo,
    onPageSeo,
    performance,
    mobileFriendliness,
    contentQuality,
    schemaMarkup,
    overallScore,
  };
}

function pagesLoadPenalty(criticalIssues, importantIssues) {
  return criticalIssues.length * 5 + importantIssues.length * 2;
}

export function clampCrawlConfig(input = {}) {
  const maxPages = Math.min(
    CRAWLER_LIMITS.maxPagesHard,
    Math.max(1, Number(input.maxPages) || CRAWLER_LIMITS.maxPagesDefault)
  );
  const maxDepth = Math.min(
    CRAWLER_LIMITS.maxDepthHard,
    Math.max(0, Number(input.maxDepth) ?? CRAWLER_LIMITS.maxDepthDefault)
  );
  const timeoutMs = Math.min(
    CRAWLER_LIMITS.timeoutMsHard,
    Math.max(1000, Number(input.timeoutMs) || CRAWLER_LIMITS.timeoutMsDefault)
  );
  const overallTimeoutMs = Math.min(
    CRAWLER_LIMITS.overallTimeoutMsHard,
    Math.max(timeoutMs, Number(input.overallTimeoutMs) || CRAWLER_LIMITS.overallTimeoutMsDefault)
  );

  return {
    maxPages,
    maxDepth,
    timeoutMs,
    overallTimeoutMs,
    maxResponseBytes: CRAWLER_LIMITS.maxResponseBytes,
    maxRedirects: CRAWLER_LIMITS.maxRedirects,
    sameDomainOnly: input.sameDomainOnly !== false,
    allowPrivateNetworks: Boolean(input.allowPrivateNetworks),
  };
}
