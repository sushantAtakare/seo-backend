/**
 * Build printable report payload from Audit + AuditResult.
 * Does not invent metrics — unavailable fields remain null/empty.
 */
export function buildReportData(audit) {
  const result = audit.result;
  const recommendations =
    result?.recommendations && typeof result.recommendations === 'object'
      ? result.recommendations
      : {};

  const crawl = recommendations.crawl || null;
  const integrations = recommendations.integrations || null;
  const aiEnvelope = recommendations.aiAnalysis || null;
  const aiData =
    aiEnvelope?.success && aiEnvelope?.data && typeof aiEnvelope.data === 'object'
      ? aiEnvelope.data
      : null;

  const pagespeedBundle = integrations?.pagespeed?.success
    ? integrations.pagespeed.data
    : null;

  const schemaBundle = integrations?.schema?.success
    ? integrations.schema.data
    : null;

  const mobile = pagespeedBundle?.mobile || null;
  const desktop = pagespeedBundle?.desktop || null;

  const coreWebVitals =
    mobile?.coreWebVitals || desktop?.coreWebVitals || null;

  const crawlFindings = extractCrawlFindings(crawl, result);
  const priorities = extractPriorities(result, aiData);
  const positiveObservations = extractPositiveObservations(result, aiData);
  const aiRecommendations = extractAiRecommendations(aiData);

  return {
    generatedAt: new Date().toISOString(),
    websiteUrl: audit.site?.url || null,
    domain: audit.site?.domain || null,
    overallScore:
      typeof audit.overallScore === 'number'
        ? audit.overallScore
        : typeof aiData?.overallScore === 'number'
          ? aiData.overallScore
          : null,
    auditSummary: {
      pagesCrawled:
        crawl?.summary?.pagesCrawled ??
        aiData?.dataAvailability?.pagesAnalyzed ??
        null,
      totalInternalLinks: crawl?.summary?.totalInternalLinks ?? null,
      totalExternalLinks: crawl?.summary?.totalExternalLinks ?? null,
      seoIssuesCount:
        (Array.isArray(result?.criticalIssues) ? result.criticalIssues.length : 0) +
        (Array.isArray(result?.importantIssues) ? result.importantIssues.length : 0) +
        (Array.isArray(result?.warnings) ? result.warnings.length : 0),
      overallAssessment: aiData?.overallAssessment || null,
      technicalSeo: result?.technicalSeo ?? null,
      onPageSeo: result?.onPageSeo ?? null,
      performance: result?.performance ?? null,
      mobileFriendliness: result?.mobileFriendliness ?? null,
      contentQuality: result?.contentQuality ?? null,
      schemaMarkup: result?.schemaMarkup ?? null,
    },
    pageSpeed: {
      mobile: {
        performance: mobile?.scores?.performance ?? null,
        accessibility: mobile?.scores?.accessibility ?? null,
        bestPractices: mobile?.scores?.bestPractices ?? null,
        seo: mobile?.scores?.seo ?? null,
      },
      desktop: {
        performance: desktop?.scores?.performance ?? null,
        accessibility: desktop?.scores?.accessibility ?? null,
        bestPractices: desktop?.scores?.bestPractices ?? null,
        seo: desktop?.scores?.seo ?? null,
      },
      available: Boolean(pagespeedBundle),
    },
    coreWebVitals: coreWebVitals
      ? {
          lcpMs: coreWebVitals.lcpMs ?? null,
          cls: coreWebVitals.cls ?? null,
          inpMs: coreWebVitals.inpMs ?? null,
          fcpMs: coreWebVitals.fcpMs ?? null,
          ttfbMs: coreWebVitals.ttfbMs ?? null,
        }
      : null,
    crawlFindings,
    schemaFindings: schemaBundle
      ? {
          detectedTypes: Array.isArray(schemaBundle.detectedTypes)
            ? schemaBundle.detectedTypes
            : [],
          score:
            typeof schemaBundle.score === 'number' ? schemaBundle.score : null,
          issues: (schemaBundle.issues || []).map(
            (issue) =>
              issue.message ||
              issue.code ||
              JSON.stringify(issue)
          ),
        }
      : null,
    aiAnalysis: {
      available: Boolean(aiData),
      recommendations: aiRecommendations,
    },
    priorities,
    positiveObservations,
  };
}

function extractCrawlFindings(crawl, result) {
  const findings = [];

  if (crawl?.summary) {
    if (typeof crawl.summary.pagesCrawled === 'number') {
      findings.push(`Pages crawled: ${crawl.summary.pagesCrawled}`);
    }
    if (typeof crawl.summary.totalInternalLinks === 'number') {
      findings.push(`Internal links discovered: ${crawl.summary.totalInternalLinks}`);
    }
    if (typeof crawl.summary.totalExternalLinks === 'number') {
      findings.push(`External links discovered: ${crawl.summary.totalExternalLinks}`);
    }
  }

  const issueGroups = [
    ['Critical', result?.criticalIssues],
    ['Important', result?.importantIssues],
    ['Warning', result?.warnings],
  ];

  for (const [label, issues] of issueGroups) {
    if (!Array.isArray(issues)) continue;
    for (const issue of issues) {
      const message = issue.message || issue.code || 'Issue';
      const url = issue.url || (Array.isArray(issue.urls) ? issue.urls[0] : null);
      findings.push(
        `[${label}] ${message}${url ? ` (${url})` : ''}`
      );
    }
  }

  if (Array.isArray(crawl?.pages)) {
    for (const page of crawl.pages.slice(0, 25)) {
      if (page.missingH1) {
        findings.push(`Missing H1 on ${page.url || 'unknown URL'}`);
      }
      if (page.title === null || page.title === '') {
        findings.push(`Missing title on ${page.url || 'unknown URL'}`);
      }
    }
  }

  return findings;
}

function mapIssue(issue, fallbackPriority) {
  return {
    title: issue.title || issue.message || issue.code || issue.action || 'Issue',
    whyItMatters: issue.whyItMatters || issue.rationale || issue.description || null,
    suggestedFix: issue.suggestedFix || issue.action || null,
    affectedUrls:
      issue.affectedUrls ||
      (issue.url ? [issue.url] : null) ||
      issue.urls ||
      [],
    priority: (issue.priority || fallbackPriority || 'medium').toLowerCase(),
  };
}

function extractPriorities(result, aiData) {
  const buckets = {
    critical: [],
    high: [],
    medium: [],
    low: [],
  };

  if (aiData && Array.isArray(aiData.issues)) {
    for (const issue of aiData.issues) {
      const mapped = mapIssue(issue, 'medium');
      if (buckets[mapped.priority]) {
        buckets[mapped.priority].push(mapped);
      } else {
        buckets.medium.push(mapped);
      }
    }
    return buckets;
  }

  for (const issue of result?.criticalIssues || []) {
    buckets.critical.push(mapIssue(issue, 'critical'));
  }
  for (const issue of result?.importantIssues || []) {
    buckets.high.push(mapIssue(issue, 'high'));
  }
  for (const issue of result?.warnings || []) {
    buckets.medium.push(mapIssue(issue, 'medium'));
  }

  return buckets;
}

function extractPositiveObservations(result, aiData) {
  if (aiData && Array.isArray(aiData.positiveObservations)) {
    return aiData.positiveObservations.map((item) =>
      typeof item === 'string' ? item : item.message || JSON.stringify(item)
    );
  }

  if (Array.isArray(result?.passedChecks)) {
    return result.passedChecks.map(
      (check) => check.message || check.code || String(check)
    );
  }

  return [];
}

function extractAiRecommendations(aiData) {
  if (!aiData || !Array.isArray(aiData.recommendations)) {
    return [];
  }

  return aiData.recommendations.map((rec) => {
    if (typeof rec === 'string') return rec;
    const action = rec.action || rec.title || 'Recommendation';
    const rationale = rec.rationale ? ` — ${rec.rationale}` : '';
    const priority = rec.priority ? `[${String(rec.priority).toUpperCase()}] ` : '';
    return `${priority}${action}${rationale}`;
  });
}

export function mapReport(report, { includeAudit = true } = {}) {
  if (!report) return null;

  return {
    id: report.id,
    auditId: report.auditId,
    status: report.status,
    filePath: report.filePath,
    generatedAt: report.generatedAt,
    createdAt: report.createdAt,
    fileAvailable: Boolean(report.filePath),
    audit: includeAudit && report.audit
      ? {
          id: report.audit.id,
          clientId: report.audit.clientId,
          siteId: report.audit.siteId,
          status: report.audit.status,
          overallScore: report.audit.overallScore,
          site: report.audit.site
            ? {
                id: report.audit.site.id,
                domain: report.audit.site.domain,
                url: report.audit.site.url,
              }
            : undefined,
        }
      : undefined,
  };
}
