function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function valueOrUnavailable(value, suffix = '') {
  if (value === null || value === undefined || value === '') {
    return '<span class="muted">Unavailable</span>';
  }
  return `${escapeHtml(value)}${suffix}`;
}

function renderList(items, emptyText) {
  if (!Array.isArray(items) || items.length === 0) {
    return `<p class="muted">${escapeHtml(emptyText)}</p>`;
  }

  return `<ul>${items
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join('')}</ul>`;
}

function renderIssueGroup(title, items) {
  if (!Array.isArray(items) || items.length === 0) {
    return `
      <section class="card">
        <h3>${escapeHtml(title)}</h3>
        <p class="muted">None reported.</p>
      </section>`;
  }

  return `
    <section class="card">
      <h3>${escapeHtml(title)} (${items.length})</h3>
      <ul class="issues">
        ${items
          .map((issue) => {
            const label = issue.title || issue.message || issue.code || 'Issue';
            const urls = issue.affectedUrls || (issue.url ? [issue.url] : issue.urls) || [];
            return `<li>
              <strong>${escapeHtml(label)}</strong>
              ${issue.whyItMatters ? `<div class="meta">${escapeHtml(issue.whyItMatters)}</div>` : ''}
              ${issue.suggestedFix ? `<div class="fix"><em>Fix:</em> ${escapeHtml(issue.suggestedFix)}</div>` : ''}
              ${
                urls.length
                  ? `<div class="urls">${urls.map((u) => escapeHtml(u)).join('<br/>')}</div>`
                  : ''
              }
            </li>`;
          })
          .join('')}
      </ul>
    </section>`;
}

/**
 * Build printable HTML for an SEO audit PDF report.
 */
export function buildReportHtml(reportData) {
  const {
    generatedAt,
    websiteUrl,
    domain,
    overallScore,
    auditSummary,
    pageSpeed,
    coreWebVitals,
    crawlFindings,
    schemaFindings,
    aiAnalysis,
    priorities,
    positiveObservations,
  } = reportData;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>SEO Audit Report</title>
  <style>
    @page {
      size: A4;
      margin: 18mm 14mm 18mm 14mm;
    }
    body {
      font-family: "Segoe UI", Arial, sans-serif;
      color: #1f2937;
      font-size: 12px;
      line-height: 1.45;
    }
    h1, h2, h3 { color: #111827; margin: 0 0 8px; }
    h1 { font-size: 22px; }
    h2 { font-size: 16px; margin-top: 22px; border-bottom: 1px solid #e5e7eb; padding-bottom: 6px; }
    h3 { font-size: 13px; }
    .muted { color: #6b7280; }
    .header {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 18px;
    }
    .score {
      min-width: 90px;
      text-align: center;
      border: 2px solid #2563eb;
      border-radius: 10px;
      padding: 10px 12px;
    }
    .score .value { font-size: 28px; font-weight: 700; color: #2563eb; }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    .card {
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 12px;
      page-break-inside: avoid;
    }
    ul { margin: 8px 0 0 18px; padding: 0; }
    .issues li { margin-bottom: 10px; }
    .meta, .fix, .urls { margin-top: 4px; color: #374151; }
    .urls { font-size: 11px; color: #4b5563; word-break: break-all; }
    .kv { margin: 4px 0; }
    .kv span { display: inline-block; min-width: 140px; color: #6b7280; }
    .footer {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      font-size: 10px;
      color: #6b7280;
      display: flex;
      justify-content: space-between;
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>SEO Audit Report</h1>
      <div class="kv"><span>Generated</span>${valueOrUnavailable(generatedAt)}</div>
      <div class="kv"><span>Website</span>${valueOrUnavailable(websiteUrl)}</div>
      <div class="kv"><span>Domain</span>${valueOrUnavailable(domain)}</div>
    </div>
    <div class="score">
      <div class="label muted">Overall Score</div>
      <div class="value">${overallScore == null ? '—' : escapeHtml(overallScore)}</div>
    </div>
  </div>

  <h2>Audit Summary</h2>
  <div class="card">
    <div class="kv"><span>Pages crawled</span>${valueOrUnavailable(auditSummary?.pagesCrawled)}</div>
    <div class="kv"><span>Internal links</span>${valueOrUnavailable(auditSummary?.totalInternalLinks)}</div>
    <div class="kv"><span>External links</span>${valueOrUnavailable(auditSummary?.totalExternalLinks)}</div>
    <div class="kv"><span>SEO issues counted</span>${valueOrUnavailable(auditSummary?.seoIssuesCount)}</div>
    <div class="kv"><span>Assessment</span>${valueOrUnavailable(auditSummary?.overallAssessment)}</div>
  </div>

  <h2>PageSpeed Insights</h2>
  <div class="grid">
    <div class="card">
      <h3>Mobile</h3>
      <div class="kv"><span>Performance</span>${valueOrUnavailable(pageSpeed?.mobile?.performance)}</div>
      <div class="kv"><span>Accessibility</span>${valueOrUnavailable(pageSpeed?.mobile?.accessibility)}</div>
      <div class="kv"><span>Best Practices</span>${valueOrUnavailable(pageSpeed?.mobile?.bestPractices)}</div>
      <div class="kv"><span>SEO</span>${valueOrUnavailable(pageSpeed?.mobile?.seo)}</div>
    </div>
    <div class="card">
      <h3>Desktop</h3>
      <div class="kv"><span>Performance</span>${valueOrUnavailable(pageSpeed?.desktop?.performance)}</div>
      <div class="kv"><span>Accessibility</span>${valueOrUnavailable(pageSpeed?.desktop?.accessibility)}</div>
      <div class="kv"><span>Best Practices</span>${valueOrUnavailable(pageSpeed?.desktop?.bestPractices)}</div>
      <div class="kv"><span>SEO</span>${valueOrUnavailable(pageSpeed?.desktop?.seo)}</div>
    </div>
  </div>

  <h2>Core Web Vitals</h2>
  <div class="card">
    <div class="kv"><span>LCP (ms)</span>${valueOrUnavailable(coreWebVitals?.lcpMs)}</div>
    <div class="kv"><span>CLS</span>${valueOrUnavailable(coreWebVitals?.cls)}</div>
    <div class="kv"><span>INP (ms)</span>${valueOrUnavailable(coreWebVitals?.inpMs)}</div>
    <div class="kv"><span>FCP (ms)</span>${valueOrUnavailable(coreWebVitals?.fcpMs)}</div>
    <div class="kv"><span>TTFB (ms)</span>${valueOrUnavailable(coreWebVitals?.ttfbMs)}</div>
    ${
      !coreWebVitals
        ? '<p class="muted">Core Web Vitals unavailable for this audit.</p>'
        : ''
    }
  </div>

  <h2>Crawl Findings</h2>
  <div class="card">
    ${renderList(crawlFindings, 'No crawl findings available.')}
  </div>

  <h2>Schema.org Validation</h2>
  <div class="card">
    ${
      schemaFindings
        ? `
    <div class="kv"><span>Detected types</span>${valueOrUnavailable(
      (schemaFindings.detectedTypes || []).join(', ')
    )}</div>
    <div class="kv"><span>Schema score</span>${valueOrUnavailable(schemaFindings.score)}</div>
    ${renderList(schemaFindings.issues || [], 'No schema validation issues reported.')}
        `
        : '<p class="muted">Schema.org validation data unavailable for this audit.</p>'
    }
  </div>

  <h2>AI Recommendations</h2>
  <div class="card">
    ${renderList(aiAnalysis?.recommendations || [], 'AI recommendations unavailable.')}
  </div>

  <h2>Issue Priorities</h2>
  ${renderIssueGroup('Critical', priorities?.critical)}
  ${renderIssueGroup('High', priorities?.high)}
  ${renderIssueGroup('Medium', priorities?.medium)}
  ${renderIssueGroup('Low', priorities?.low)}

  <h2>Positive Observations</h2>
  <div class="card">
    ${renderList(positiveObservations, 'No positive observations recorded.')}
  </div>

</body>
</html>`;
}
