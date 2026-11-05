import prisma from '../../config/prisma.js';
import env from '../../config/env.js';
import ApiError from '../../utils/ApiError.js';
import { assertCanAccessClient } from '../../utils/access.js';
import { enqueueAuditCrawlJob } from '../queue/audit.jobs.js';
import {
  CRAWLER_USER_AGENT,
  assertSafePublicUrl,
  buildIssueSets,
  clampCrawlConfig,
  detectDuplicateSignals,
  extractPageSeo,
  isPathAllowedByRobots,
  isSameDomain,
  normalizeUrl,
  parseRobotsTxt,
  scoreFromIssues,
} from './crawler.utils.js';

const ALLOWED_AUDIT_STATUSES = new Set(['PENDING', 'FAILED', 'COMPLETED', 'PROCESSING']);
const HTML_CONTENT_TYPES = [
  'text/html',
  'application/xhtml+xml',
];

function isHtmlContentType(contentType) {
  if (!contentType) return false;
  const normalized = String(contentType).split(';')[0].trim().toLowerCase();
  return HTML_CONTENT_TYPES.includes(normalized);
}

async function readResponseBodyLimited(response, maxBytes) {
  if (!response.body || typeof response.body.getReader !== 'function') {
    const text = await response.text();
    const bytes = Buffer.byteLength(text, 'utf8');
    if (bytes > maxBytes) {
      throw new ApiError(400, 'Response exceeds size limit');
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        // ignore cancel errors
      }
      throw new ApiError(400, 'Response exceeds size limit');
    }
    chunks.push(Buffer.from(value));
  }

  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Fetch a URL with SSRF checks, manual redirects, timeouts, and size limits.
 */
export async function safeFetch(rawUrl, config) {
  let currentUrl = normalizeUrl(rawUrl);
  if (!currentUrl) {
    throw new ApiError(400, 'Invalid URL');
  }

  for (let redirectCount = 0; redirectCount <= config.maxRedirects; redirectCount += 1) {
    await assertSafePublicUrl(currentUrl, {
      allowPrivateNetworks: config.allowPrivateNetworks,
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    const started = Date.now();

    try {
      const response = await fetch(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': CRAWLER_USER_AGENT,
          Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        },
      });

      const loadTimeMs = Date.now() - started;
      const statusCode = response.status;

      if ([301, 302, 303, 307, 308].includes(statusCode)) {
        const location = response.headers.get('location');
        if (!location) {
          throw new ApiError(400, 'Redirect missing location header');
        }

        const nextUrl = normalizeUrl(location, currentUrl);
        if (!nextUrl) {
          throw new ApiError(400, 'Invalid redirect target');
        }

        // Revalidate every hop (including private destinations)
        await assertSafePublicUrl(nextUrl, {
          allowPrivateNetworks: config.allowPrivateNetworks,
        });

        currentUrl = nextUrl;
        continue;
      }

      const contentType = response.headers.get('content-type') || '';

      if (!isHtmlContentType(contentType)) {
        throw new ApiError(400, 'Unsupported content type');
      }

      const html = await readResponseBodyLimited(
        response,
        config.maxResponseBytes
      );

      return {
        finalUrl: currentUrl,
        statusCode,
        contentType: contentType.split(';')[0].trim().toLowerCase(),
        loadTimeMs,
        html,
      };
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }

      if (error?.name === 'AbortError') {
        throw new ApiError(408, 'Crawl request timed out');
      }

      throw new ApiError(400, 'Failed to fetch target URL');
    } finally {
      clearTimeout(timer);
    }
  }

  throw new ApiError(400, 'Too many redirects');
}

async function loadRobotsRules(originUrl, config) {
  try {
    const robotsUrl = `${new URL(originUrl).origin}/robots.txt`;

    await assertSafePublicUrl(robotsUrl, {
      allowPrivateNetworks: config.allowPrivateNetworks,
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const response = await fetch(robotsUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'User-Agent': CRAWLER_USER_AGENT },
      });

      if (!response.ok) {
        return { allow: [], disallow: [] };
      }

      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      if (
        contentType &&
        !contentType.includes('text/plain') &&
        !contentType.includes('text/html')
      ) {
        return { allow: [], disallow: [] };
      }

      const text = await readResponseBodyLimited(response, 100_000);
      return parseRobotsTxt(text, CRAWLER_USER_AGENT);
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // Fail open only when robots.txt is unavailable; SSRF still applies to page fetches
    return { allow: [], disallow: [] };
  }
}

/**
 * Crawl a starting URL within configured limits (BFS by depth).
 */
export async function crawlWebsite(startUrl, rawConfig = {}) {
  const config = clampCrawlConfig(rawConfig);
  const normalizedStart = normalizeUrl(startUrl);

  if (!normalizedStart) {
    throw new ApiError(400, 'Invalid start URL');
  }

  await assertSafePublicUrl(normalizedStart, {
    allowPrivateNetworks: config.allowPrivateNetworks,
  });

  const robotsRules = await loadRobotsRules(normalizedStart, config);
  const queue = [{ url: normalizedStart, depth: 0 }];
  const seen = new Set();
  const pages = [];
  const startedAt = Date.now();

  while (queue.length > 0 && pages.length < config.maxPages) {
    if (Date.now() - startedAt > config.overallTimeoutMs) {
      break;
    }

    const current = queue.shift();
    const url = normalizeUrl(current.url);

    if (!url || seen.has(url)) {
      continue;
    }

    seen.add(url);

    if (config.sameDomainOnly && !isSameDomain(url, normalizedStart)) {
      continue;
    }

    let pathname = '/';
    try {
      pathname = new URL(url).pathname || '/';
    } catch {
      continue;
    }

    if (!isPathAllowedByRobots(pathname, robotsRules)) {
      continue;
    }

    try {
      const fetched = await safeFetch(url, config);
      const seo = extractPageSeo(fetched.html, fetched.finalUrl);

      const page = {
        ...seo,
        requestedUrl: url,
        statusCode: fetched.statusCode,
        contentType: fetched.contentType,
        loadTimeMs: fetched.loadTimeMs,
      };

      pages.push(page);

      if (current.depth < config.maxDepth) {
        for (const link of page.internalLinks) {
          const normalizedLink = normalizeUrl(link);
          if (!normalizedLink || seen.has(normalizedLink)) continue;
          if (config.sameDomainOnly && !isSameDomain(normalizedLink, normalizedStart)) {
            continue;
          }
          queue.push({ url: normalizedLink, depth: current.depth + 1 });
        }
      }
    } catch (error) {
      if (pages.length === 0 && url === normalizedStart) {
        throw error;
      }

      pages.push({
        url,
        requestedUrl: url,
        title: null,
        metaDescription: null,
        metaKeywords: null,
        canonical: null,
        robotsMeta: null,
        language: null,
        headings: { h1: [], h2: [], h3: [], h4: [], h5: [], h6: [] },
        internalLinks: [],
        externalLinks: [],
        images: [],
        imagesMissingAlt: [],
        jsonLdBlocks: [],
        missingTitle: true,
        missingMetaDescription: true,
        missingH1: true,
        multipleH1: false,
        statusCode: error.statusCode === 408 ? 408 : 0,
        contentType: null,
        loadTimeMs: null,
        error: error instanceof ApiError ? error.message : 'Failed to fetch page',
      });
    }
  }

  const duplicates = detectDuplicateSignals(pages);
  const issues = buildIssueSets(pages, duplicates);
  const scores = scoreFromIssues(issues);

  const summary = {
    pagesCrawled: pages.length,
    totalInternalLinks: pages.reduce((sum, p) => sum + (p.internalLinks?.length || 0), 0),
    totalExternalLinks: pages.reduce((sum, p) => sum + (p.externalLinks?.length || 0), 0),
    seoIssuesCount:
      issues.criticalIssues.length +
      issues.importantIssues.length +
      issues.warnings.length,
    criticalIssuesCount: issues.criticalIssues.length,
    importantIssuesCount: issues.importantIssues.length,
    warningsCount: issues.warnings.length,
    duplicates,
    config: {
      maxPages: config.maxPages,
      maxDepth: config.maxDepth,
      timeoutMs: config.timeoutMs,
      sameDomainOnly: config.sameDomainOnly,
    },
  };

  return {
    summary,
    pages,
    issues,
    scores,
  };
}

async function getOwnedAudit(actor, auditId) {
  const audit = await prisma.audit.findUnique({
    where: { id: auditId },
    include: {
      site: true,
      result: true,
    },
  });

  if (!audit) {
    throw new ApiError(404, 'Audit not found');
  }

  assertCanAccessClient(actor, audit.clientId);

  return audit;
}

async function persistCrawlOutcome(audit, crawl) {
  const recommendations = {
    crawl: {
      summary: crawl.summary,
      pages: crawl.pages.map((page) => ({
        url: page.url,
        requestedUrl: page.requestedUrl,
        statusCode: page.statusCode,
        contentType: page.contentType,
        loadTimeMs: page.loadTimeMs,
        title: page.title,
        metaDescription: page.metaDescription,
        metaKeywords: page.metaKeywords,
        canonical: page.canonical,
        robotsMeta: page.robotsMeta,
        language: page.language,
        headings: page.headings,
        internalLinks: page.internalLinks,
        externalLinks: page.externalLinks,
        imagesMissingAltCount: page.imagesMissingAlt?.length || 0,
        jsonLdBlocks: page.jsonLdBlocks || [],
        missingTitle: page.missingTitle,
        missingMetaDescription: page.missingMetaDescription,
        missingH1: page.missingH1,
        error: page.error || null,
      })),
      error: null,
    },
  };

  const resultData = {
    technicalSeo: crawl.scores.technicalSeo,
    onPageSeo: crawl.scores.onPageSeo,
    performance: crawl.scores.performance,
    mobileFriendliness: crawl.scores.mobileFriendliness,
    contentQuality: crawl.scores.contentQuality,
    schemaMarkup: crawl.scores.schemaMarkup,
    criticalIssues: crawl.issues.criticalIssues,
    importantIssues: crawl.issues.importantIssues,
    warnings: crawl.issues.warnings,
    passedChecks: crawl.issues.passedChecks,
    recommendations,
  };

  // Idempotent upsert — retries overwrite the same AuditResult row
  await prisma.auditResult.upsert({
    where: { auditId: audit.id },
    create: {
      auditId: audit.id,
      ...resultData,
    },
    update: resultData,
  });

  await prisma.audit.update({
    where: { id: audit.id },
    data: {
      status: 'COMPLETED',
      overallScore: crawl.scores.overallScore,
      completedAt: new Date(),
    },
  });

  return {
    auditId: audit.id,
    siteId: audit.siteId,
    status: 'COMPLETED',
    overallScore: crawl.scores.overallScore,
    summary: crawl.summary,
    pagesCrawled: crawl.summary.pagesCrawled,
    totalInternalLinks: crawl.summary.totalInternalLinks,
    totalExternalLinks: crawl.summary.totalExternalLinks,
    seoIssuesCount: crawl.summary.seoIssuesCount,
    pages: recommendations.crawl.pages,
    scores: crawl.scores,
  };
}

async function markAuditFailed(auditId, errorMessage) {
  const existing = await prisma.audit.findUnique({
    where: { id: auditId },
    include: { result: true },
  });

  if (!existing) {
    return;
  }

  const safeMessage = String(errorMessage || 'Crawl failed').slice(0, 300);

  if (existing.result) {
    const recommendations =
      existing.result.recommendations &&
      typeof existing.result.recommendations === 'object'
        ? { ...existing.result.recommendations }
        : {};

    recommendations.crawlError = {
      message: safeMessage,
      at: new Date().toISOString(),
    };

    await prisma.auditResult.update({
      where: { auditId },
      data: { recommendations },
    });
  }

  await prisma.audit.update({
    where: { id: auditId },
    data: {
      status: 'FAILED',
      completedAt: new Date(),
    },
  });
}

/**
 * Enqueue an audit crawl job (API path). Does not run the crawler inline.
 */
export async function enqueueAuditCrawl(actor, auditId, rawConfig = {}) {
  const audit = await getOwnedAudit(actor, auditId);

  if (!ALLOWED_AUDIT_STATUSES.has(audit.status)) {
    throw new ApiError(
      409,
      `Audit cannot be crawled while status is ${audit.status}`
    );
  }

  const startUrl = audit.site?.url;
  if (!startUrl) {
    throw new ApiError(400, 'Audit site URL is missing');
  }

  // Fail fast for permanent URL/SSRF issues before queueing
  await assertSafePublicUrl(startUrl, {
    allowPrivateNetworks: env.crawler.allowPrivateNetworks,
  });

  const crawlConfig = clampCrawlConfig(rawConfig);

  const previousStatus = audit.status;

  await prisma.audit.update({
    where: { id: audit.id },
    data: {
      status: 'PROCESSING',
      startedAt: audit.startedAt ?? new Date(),
      completedAt: null,
    },
  });

  try {
    const job = await enqueueAuditCrawlJob({
      auditId: audit.id,
      siteId: audit.siteId,
      clientId: audit.clientId,
      crawlConfig: {
        maxPages: crawlConfig.maxPages,
        maxDepth: crawlConfig.maxDepth,
        timeoutMs: crawlConfig.timeoutMs,
        sameDomainOnly: crawlConfig.sameDomainOnly,
      },
      requestedBy: actor?.id || null,
    });

    return {
      auditId: audit.id,
      jobId: job.jobId,
      status: 'PROCESSING',
      message: 'Audit crawl job queued',
    };
  } catch (error) {
    // Roll back processing flag if enqueue failed (except duplicate-in-progress)
    if (!(error instanceof ApiError && error.statusCode === 409)) {
      await prisma.audit.update({
        where: { id: audit.id },
        data: {
          status: previousStatus === 'PROCESSING' ? 'PENDING' : previousStatus,
        },
      });
    }

    throw error;
  }
}

/**
 * Worker entry: crawl + persist results for an audit.
 */
export async function processAuditCrawl(
  auditId,
  rawConfig = {},
  { onProgress } = {}
) {
  const audit = await prisma.audit.findUnique({
    where: { id: auditId },
    include: {
      site: true,
      result: true,
    },
  });

  if (!audit) {
    throw new ApiError(404, 'Audit not found');
  }

  const startUrl = audit.site?.url;
  if (!startUrl) {
    await markAuditFailed(auditId, 'Audit site URL is missing');
    throw new ApiError(400, 'Audit site URL is missing');
  }

  if (typeof onProgress === 'function') {
    await onProgress(10);
  }

  await prisma.audit.update({
    where: { id: audit.id },
    data: {
      status: 'PROCESSING',
      startedAt: audit.startedAt ?? new Date(),
      completedAt: null,
    },
  });

  try {
    if (typeof onProgress === 'function') {
      await onProgress(25);
    }

    const crawl = await crawlWebsite(startUrl, {
      ...rawConfig,
      allowPrivateNetworks:
        rawConfig.allowPrivateNetworks ?? env.crawler.allowPrivateNetworks,
    });

    if (typeof onProgress === 'function') {
      await onProgress(80);
    }

    const result = await persistCrawlOutcome(audit, crawl);

    if (typeof onProgress === 'function') {
      await onProgress(100);
    }

    return result;
  } catch (error) {
    const message =
      error instanceof ApiError ? error.message : 'Crawl failed';
    await markAuditFailed(auditId, message);

    if (error instanceof ApiError) {
      throw error;
    }

    throw new ApiError(500, 'Crawl failed');
  }
}

/**
 * @deprecated Prefer enqueueAuditCrawl for API usage.
 * Kept as an alias for clarity in older imports.
 */
export async function crawlAudit(actor, auditId, rawConfig = {}) {
  return enqueueAuditCrawl(actor, auditId, rawConfig);
}
