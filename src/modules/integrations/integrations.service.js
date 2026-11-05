import prisma from '../../config/prisma.js';
import integrations from '../../config/integrations.js';
import { analyzePageSpeed } from './pagespeed/pagespeed.service.js';
import { analyzeSearchConsole } from './search-console/search-console.service.js';
import { analyzeDataForSeo } from './dataforseo/dataforseo.service.js';
import { validateSchemaMarkup } from './schema/schema.service.js';

function extractDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function collectJsonLdFromCrawl(crawlResult) {
  const pages = crawlResult?.pages || [];
  return pages.flatMap((page) => page.jsonLdBlocks || []);
}

function mergeScores(existing, pageSpeed, schema) {
  const next = { ...existing };

  if (pageSpeed?.success && pageSpeed.data?.mobile?.scores) {
    const mobile = pageSpeed.data.mobile.scores;
    const desktop = pageSpeed.data.desktop?.scores || {};

    if (typeof mobile.performance === 'number') {
      next.performance = mobile.performance;
    }
    if (
      typeof mobile.performance === 'number' &&
      typeof desktop.performance === 'number'
    ) {
      next.mobileFriendliness = Math.round(
        (mobile.performance * 0.7 + desktop.performance * 0.3)
      );
    } else if (typeof mobile.performance === 'number') {
      next.mobileFriendliness = mobile.performance;
    }
    if (typeof mobile.seo === 'number') {
      next.technicalSeo = Math.round(
        (existing.technicalSeo + mobile.seo) / 2
      );
    }
  }

  if (schema?.success && typeof schema.data?.score === 'number') {
    next.schemaMarkup = schema.data.score;
  }

  const overallScore = Math.round(
    (next.technicalSeo +
      next.onPageSeo +
      next.performance +
      next.mobileFriendliness +
      next.contentQuality +
      next.schemaMarkup) /
      6
  );

  return { ...next, overallScore };
}

function mergeIssues(existingResult, schema) {
  const criticalIssues = [...(existingResult.criticalIssues || [])];
  const importantIssues = [...(existingResult.importantIssues || [])];
  const warnings = [...(existingResult.warnings || [])];
  const passedChecks = [...(existingResult.passedChecks || [])];

  if (schema?.success && Array.isArray(schema.data?.issues)) {
    for (const issue of schema.data.issues) {
      const mapped = {
        code: `SCHEMA_${issue.code}`,
        message: issue.message,
        source: 'schema',
        path: issue.path,
        type: issue.type,
        property: issue.property,
      };

      if (issue.severity === 'critical') criticalIssues.push(mapped);
      else if (issue.severity === 'important') importantIssues.push(mapped);
      else warnings.push(mapped);
    }

    if (schema.data.summary?.hasStructuredData) {
      passedChecks.push({
        code: 'HAS_STRUCTURED_DATA',
        source: 'schema',
      });
    }
  }

  return { criticalIssues, importantIssues, warnings, passedChecks };
}

/**
 * Run all SEO integrations for a URL / crawl context.
 */
export async function runAuditIntegrations({
  url,
  domain,
  crawlResult = null,
  html = '',
  dateRange = {},
  keyword = null,
} = {}) {
  const targetUrl = url || crawlResult?.pages?.[0]?.url || null;
  const targetDomain = domain || extractDomain(targetUrl);

  const jsonLdBlocks = collectJsonLdFromCrawl(crawlResult);

  const [pagespeed, searchConsole, dataforseo, schema] = await Promise.all([
    analyzePageSpeed(targetUrl),
    analyzeSearchConsole(targetUrl, dateRange),
    analyzeDataForSeo(targetDomain, { keyword }),
    validateSchemaMarkup({
      html,
      jsonLdBlocks,
    }),
  ]);

  return {
    useMocks: integrations.useMocks,
    pagespeed,
    searchConsole,
    dataforseo,
    schema,
  };
}

/**
 * Persist integration outputs into AuditResult without discarding crawl data.
 * Integration failures are stored; audit remains COMPLETED if crawl succeeded.
 */
export async function enrichAuditWithIntegrations(auditId, crawlResult) {
  const audit = await prisma.audit.findUnique({
    where: { id: auditId },
    include: {
      site: true,
      result: true,
    },
  });

  if (!audit?.result) {
    return {
      auditId,
      skipped: true,
      reason: 'AuditResult not found',
    };
  }

  const integrationBundle = await runAuditIntegrations({
    url: audit.site?.url,
    domain: audit.site?.domain,
    crawlResult,
  });

  const existingRecommendations =
    audit.result.recommendations &&
    typeof audit.result.recommendations === 'object'
      ? { ...audit.result.recommendations }
      : {};

  existingRecommendations.integrations = integrationBundle;

  const mergedScores = mergeScores(
    {
      technicalSeo: audit.result.technicalSeo,
      onPageSeo: audit.result.onPageSeo,
      performance: audit.result.performance,
      mobileFriendliness: audit.result.mobileFriendliness,
      contentQuality: audit.result.contentQuality,
      schemaMarkup: audit.result.schemaMarkup,
    },
    integrationBundle.pagespeed,
    integrationBundle.schema
  );

  const mergedIssues = mergeIssues(audit.result, integrationBundle.schema);

  await prisma.auditResult.update({
    where: { auditId },
    data: {
      technicalSeo: mergedScores.technicalSeo,
      onPageSeo: mergedScores.onPageSeo,
      performance: mergedScores.performance,
      mobileFriendliness: mergedScores.mobileFriendliness,
      contentQuality: mergedScores.contentQuality,
      schemaMarkup: mergedScores.schemaMarkup,
      criticalIssues: mergedIssues.criticalIssues,
      importantIssues: mergedIssues.importantIssues,
      warnings: mergedIssues.warnings,
      passedChecks: mergedIssues.passedChecks,
      recommendations: existingRecommendations,
    },
  });

  await prisma.audit.update({
    where: { id: auditId },
    data: {
      overallScore: mergedScores.overallScore,
      // Keep COMPLETED after successful crawl even if some integrations failed
      status: 'COMPLETED',
    },
  });

  return {
    auditId,
    skipped: false,
    overallScore: mergedScores.overallScore,
    integrations: integrationBundle,
  };
}
