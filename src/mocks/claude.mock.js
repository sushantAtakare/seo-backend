/**
 * Deterministic Claude AI SEO analysis mock.
 * Recommendations are derived only from provided audit context.
 */

function pushUnique(list, item, keyFn) {
  const key = keyFn(item);
  if (!list.some((existing) => keyFn(existing) === key)) {
    list.push(item);
  }
}

export function getMockClaudeSeoAnalysis(context = {}) {
  const crawl = context.crawl || {};
  const scores = context.scores || {};
  const integrations = context.integrations || {};
  const pages = Array.isArray(crawl.pages) ? crawl.pages : [];
  const critical = Array.isArray(context.criticalIssues)
    ? context.criticalIssues
    : [];
  const important = Array.isArray(context.importantIssues)
    ? context.importantIssues
    : [];
  const warnings = Array.isArray(context.warnings) ? context.warnings : [];

  const unavailableSources = [];
  if (!crawl?.summary) unavailableSources.push('crawler');
  if (!integrations?.pagespeed?.success) unavailableSources.push('pagespeed');
  if (!integrations?.searchConsole?.success) {
    unavailableSources.push('search-console');
  }
  if (!integrations?.dataforseo?.success) unavailableSources.push('dataforseo');
  if (!integrations?.schema?.success) unavailableSources.push('schema');

  const issues = [];
  const recommendations = [];
  const positiveObservations = [];

  for (const issue of critical) {
    pushUnique(
      issues,
      {
        id: `critical-${issue.code || issues.length}`,
        priority: 'critical',
        title: issue.message || issue.code || 'Critical SEO issue',
        whyItMatters:
          'Critical issues block crawlability, rankings, or core user trust signals.',
        suggestedFix:
          'Resolve this issue before optimizing secondary SEO factors.',
        affectedUrls: issue.url ? [issue.url] : issue.urls || [],
        source: issue.source || 'crawler',
      },
      (item) => item.id
    );

    recommendations.push({
      id: `rec-critical-${issue.code || recommendations.length}`,
      priority: 'critical',
      action: issue.message || 'Fix critical SEO defect',
      rationale: 'Critical defects disproportionately limit organic visibility.',
      affectedUrls: issue.url ? [issue.url] : issue.urls || [],
    });
  }

  for (const issue of important) {
    pushUnique(
      issues,
      {
        id: `high-${issue.code || issues.length}`,
        priority: 'high',
        title: issue.message || issue.code || 'High-priority SEO issue',
        whyItMatters:
          'High-priority issues reduce relevance signals and conversion quality.',
        suggestedFix: 'Address this in the next optimization sprint.',
        affectedUrls: issue.url ? [issue.url] : issue.urls || [],
        source: issue.source || 'crawler',
      },
      (item) => item.id
    );

    recommendations.push({
      id: `rec-high-${issue.code || recommendations.length}`,
      priority: 'high',
      action: issue.message || 'Improve on-page SEO signal',
      rationale: 'Improving this signal strengthens topical relevance.',
      affectedUrls: issue.url ? [issue.url] : issue.urls || [],
    });
  }

  for (const issue of warnings.slice(0, 8)) {
    pushUnique(
      issues,
      {
        id: `medium-${issue.code || issues.length}`,
        priority: 'medium',
        title: issue.message || issue.code || 'Medium-priority SEO warning',
        whyItMatters:
          'Warnings rarely block indexing alone, but they weaken consistency and clarity.',
        suggestedFix: 'Clean up warnings after critical and high items.',
        affectedUrls: issue.url ? [issue.url] : issue.urls || [],
        source: issue.source || 'crawler',
      },
      (item) => item.id
    );
  }

  if (integrations?.pagespeed?.success) {
    const mobilePerf = integrations.pagespeed.data?.mobile?.scores?.performance;
    if (typeof mobilePerf === 'number' && mobilePerf < 80) {
      issues.push({
        id: 'high-mobile-performance',
        priority: 'high',
        title: `Mobile PageSpeed performance is ${mobilePerf}/100`,
        whyItMatters:
          'Slow mobile experiences increase bounce rate and can suppress rankings.',
        suggestedFix:
          'Reduce unused JavaScript, compress media, and improve LCP resources.',
        affectedUrls: context.url ? [context.url] : [],
        source: 'pagespeed',
      });
      recommendations.push({
        id: 'rec-mobile-performance',
        priority: 'high',
        action: 'Improve mobile Core Web Vitals and PageSpeed performance',
        rationale: 'Mobile performance is a primary ranking and UX constraint.',
        affectedUrls: context.url ? [context.url] : [],
      });
    } else if (typeof mobilePerf === 'number') {
      positiveObservations.push(
        `Mobile PageSpeed performance is solid at ${mobilePerf}/100.`
      );
    }
  } else {
    positiveObservations.push(
      'PageSpeed data was unavailable, so performance recommendations are limited.'
    );
  }

  if (integrations?.schema?.success) {
    if (integrations.schema.data?.summary?.hasStructuredData) {
      positiveObservations.push(
        `Structured data detected (${(integrations.schema.data.detectedTypes || []).join(', ') || 'types found'}).`
      );
    } else {
      issues.push({
        id: 'medium-missing-schema',
        priority: 'medium',
        title: 'No JSON-LD structured data detected',
        whyItMatters:
          'Missing schema reduces eligibility for rich results and clearer entity understanding.',
        suggestedFix:
          'Add valid Organization/WebSite JSON-LD and validate required properties.',
        affectedUrls: context.url ? [context.url] : [],
        source: 'schema',
      });
    }
  }

  if (integrations?.searchConsole?.success) {
    const ctr = integrations.searchConsole.data?.totals?.ctr;
    if (typeof ctr === 'number' && ctr < 0.04) {
      issues.push({
        id: 'medium-low-ctr',
        priority: 'medium',
        title: `Search CTR is low (${ctr})`,
        whyItMatters:
          'Low CTR means impressions are not converting into visits despite visibility.',
        suggestedFix:
          'Improve title/meta relevance for top queries and test clearer value propositions.',
        affectedUrls:
          integrations.searchConsole.data?.topPages?.slice(0, 3).map((p) => p.page) ||
          [],
        source: 'search-console',
      });
    } else {
      positiveObservations.push(
        'Search Console metrics are available for query and page prioritization.'
      );
    }
  }

  if (integrations?.dataforseo?.success) {
    const difficulty =
      integrations.dataforseo.data?.keywordInfo?.keywordDifficulty;
    if (typeof difficulty === 'number' && difficulty >= 50) {
      issues.push({
        id: 'low-keyword-difficulty',
        priority: 'low',
        title: `Primary keyword difficulty is ${difficulty}`,
        whyItMatters:
          'High-difficulty terms require stronger topical authority and supporting content.',
        suggestedFix:
          'Target supporting long-tail keywords while building authority content hubs.',
        affectedUrls: [],
        source: 'dataforseo',
      });
    } else {
      positiveObservations.push(
        'Keyword opportunity data is available to guide content prioritization.'
      );
    }
  }

  const pagesWithTitle = pages.filter((p) => p.title);
  if (pagesWithTitle.length) {
    positiveObservations.push(
      `${pagesWithTitle.length} crawled page(s) include a title tag.`
    );
  }

  const prioritySummary = {
    critical: issues.filter((i) => i.priority === 'critical').length,
    high: issues.filter((i) => i.priority === 'high').length,
    medium: issues.filter((i) => i.priority === 'medium').length,
    low: issues.filter((i) => i.priority === 'low').length,
  };

  if (!recommendations.length && issues.length) {
    recommendations.push({
      id: 'rec-general-cleanup',
      priority: issues[0].priority,
      action: 'Resolve the highest-priority detected SEO issues first',
      rationale: 'Sequencing fixes by severity maximizes ranking recovery speed.',
      affectedUrls: issues[0].affectedUrls || [],
    });
  }

  if (!recommendations.length) {
    recommendations.push({
      id: 'rec-maintain',
      priority: 'low',
      action: 'Maintain current SEO hygiene and monitor key metrics monthly',
      rationale: 'No severe defects were present in the available dataset.',
      affectedUrls: context.url ? [context.url] : [],
    });
  }

  const scoreCandidates = [
    scores.overallScore,
    scores.technicalSeo,
    scores.onPageSeo,
    scores.performance,
  ].filter((n) => typeof n === 'number');

  const overallScore =
    scoreCandidates.length > 0
      ? Math.round(
          scoreCandidates.reduce((sum, n) => sum + n, 0) / scoreCandidates.length
        )
      : null;

  const unavailableNote = unavailableSources.length
    ? ` Unavailable sources: ${unavailableSources.join(', ')}.`
    : '';

  return {
    overallAssessment:
      `SEO posture is ${
        overallScore == null
          ? 'partially measurable'
          : overallScore >= 80
            ? 'strong'
            : overallScore >= 60
              ? 'moderate'
              : 'weak'
      } based on available crawl and integration evidence.` +
      ` Found ${prioritySummary.critical} critical, ${prioritySummary.high} high, ${prioritySummary.medium} medium, and ${prioritySummary.low} low issues.` +
      unavailableNote,
    overallScore,
    issues,
    recommendations,
    positiveObservations,
    prioritySummary,
    dataAvailability: {
      unavailableSources,
      pagesAnalyzed: pages.length,
    },
  };
}
