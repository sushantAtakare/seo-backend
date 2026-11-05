import 'dotenv/config';
import prisma from '../src/config/prisma.js';
import integrationsConfig from '../src/config/integrations.js';
import {
  analyzeSeoWithClaude,
  validateClaudeAnalysisData,
} from '../src/modules/integrations/claude/claude.service.js';
import { enrichAuditWithAiAnalysis } from '../src/modules/integrations/claude/ai-analysis.service.js';
import { createAuditWorker } from '../src/modules/queue/audit.worker.js';
import { enqueueAuditCrawlJob } from '../src/modules/queue/audit.jobs.js';
import { closeAuditQueue } from '../src/modules/queue/audit.queue.js';
import { closeRedisConnection } from '../src/config/redis.js';
import http from 'http';

let passed = 0;
let failed = 0;

function assert(condition, label, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`PASS  ${label}`);
  } else {
    failed += 1;
    console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function isNormalized(response) {
  return (
    response &&
    response.source === 'claude-ai' &&
    typeof response.success === 'boolean' &&
    typeof response.mock === 'boolean' &&
    typeof response.fetchedAt === 'string' &&
    Array.isArray(response.errors) &&
    Object.prototype.hasOwnProperty.call(response, 'data')
  );
}

async function waitFor(predicate, { timeoutMs = 35000, intervalMs = 250 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

function startFixtureServer() {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <title>AI Fixture Home</title>
  <meta name="description" content="AI analysis fixture" />
  <script type="application/ld+json">
  {"@type":"Organization","name":"AI Fixture","url":"https://ai-fixture.example"}
  </script>
</head>
<body>
  <h1>AI Fixture Home</h1>
  <img src="/x.png" />
</body>
</html>`;

  const server = http.createServer((req, res) => {
    if (req.url === '/robots.txt') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('User-agent: *\nDisallow:\n');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, origin: `http://127.0.0.1:${port}` });
    });
  });
}

async function cleanup(ids) {
  const { auditIds = [], siteIds = [], clientIds = [] } = ids;
  if (auditIds.length) {
    await prisma.auditResult.deleteMany({ where: { auditId: { in: auditIds } } });
    await prisma.audit.deleteMany({ where: { id: { in: auditIds } } });
  }
  if (siteIds.length) await prisma.site.deleteMany({ where: { id: { in: siteIds } } });
  if (clientIds.length) await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
}

async function run() {
  console.log('Running AI analysis tests\n');

  assert(integrationsConfig.useMocks === true, 'USE_MOCKS enabled for AI tests');

  const sampleContext = {
    url: 'https://example.com/',
    domain: 'example.com',
    scores: {
      overallScore: 68,
      technicalSeo: 70,
      onPageSeo: 65,
      performance: 72,
    },
    criticalIssues: [
      {
        code: 'MISSING_H1',
        message: 'Page is missing an H1 heading',
        url: 'https://example.com/about',
      },
    ],
    importantIssues: [
      {
        code: 'IMAGES_MISSING_ALT',
        message: '2 image(s) missing alt text',
        url: 'https://example.com/',
      },
    ],
    warnings: [
      {
        code: 'DUPLICATE_TITLE',
        message: 'Duplicate title across 2 pages',
        urls: ['https://example.com/', 'https://example.com/about'],
      },
    ],
    crawl: {
      summary: { pagesCrawled: 2 },
      pages: [
        { url: 'https://example.com/', title: 'Home', missingH1: false },
        { url: 'https://example.com/about', title: 'Home', missingH1: true },
      ],
    },
    integrations: {
      pagespeed: {
        success: true,
        data: { mobile: { scores: { performance: 71, seo: 90 } } },
      },
      searchConsole: { success: false, errors: ['not configured'] },
      dataforseo: { success: true, data: { keywordInfo: { keywordDifficulty: 55 } } },
      schema: {
        success: true,
        data: {
          detectedTypes: ['Organization'],
          summary: { hasStructuredData: true },
        },
      },
    },
  };

  const mockAi = await analyzeSeoWithClaude(sampleContext);
  assert(isNormalized(mockAi), 'Valid structured response envelope');
  assert(mockAi.success === true && mockAi.mock === true, 'Mock AI analysis succeeds');
  assert(
    typeof mockAi.data.overallAssessment === 'string' &&
      Array.isArray(mockAi.data.issues) &&
      Array.isArray(mockAi.data.recommendations) &&
      Array.isArray(mockAi.data.positiveObservations) &&
      typeof mockAi.data.prioritySummary === 'object',
    'Mock AI data shape is valid'
  );
  assert(
    mockAi.data.issues.some((i) => i.priority === 'critical'),
    'Mock AI uses collected critical crawl issues'
  );

  const missingInput = await analyzeSeoWithClaude({});
  assert(
    missingInput.success === false &&
      missingInput.errors.some((e) => /Insufficient audit data/i.test(e)),
    'Missing input data handled'
  );

  const invalidValidation = validateClaudeAnalysisData({
    overallAssessment: '',
    issues: 'nope',
  });
  assert(invalidValidation.valid === false, 'Invalid AI response handling');

  // Missing API key in real mode
  const previous = integrationsConfig.useMocks;
  integrationsConfig.useMocks = false;
  integrationsConfig.anthropic.apiKey = '';
  const missingKey = await analyzeSeoWithClaude(sampleContext);
  assert(
    missingKey.success === false &&
      missingKey.mock === false &&
      missingKey.errors.some((e) => /not configured/i.test(e)),
    'Missing Claude API key in real mode'
  );
  integrationsConfig.useMocks = previous;

  // Persistence without losing crawl/integration data
  const created = { auditIds: [], siteIds: [], clientIds: [] };
  const fixture = await startFixtureServer();
  let worker;

  try {
    const client = await prisma.client.create({
      data: {
        businessName: 'AI Analysis Co',
        website: 'https://ai-analysis.example',
        contactPerson: 'AI Owner',
        contactEmail: 'owner@ai-analysis.example',
        industry: 'SEO',
      },
    });
    created.clientIds.push(client.id);

    const site = await prisma.site.create({
      data: {
        clientId: client.id,
        domain: '127.0.0.1',
        url: `${fixture.origin}/`,
      },
    });
    created.siteIds.push(site.id);

    const audit = await prisma.audit.create({
      data: {
        clientId: client.id,
        siteId: site.id,
        status: 'COMPLETED',
        overallScore: 70,
      },
    });
    created.auditIds.push(audit.id);

    await prisma.auditResult.create({
      data: {
        auditId: audit.id,
        technicalSeo: 70,
        onPageSeo: 70,
        performance: 70,
        mobileFriendliness: 70,
        contentQuality: 70,
        schemaMarkup: 60,
        criticalIssues: sampleContext.criticalIssues,
        importantIssues: sampleContext.importantIssues,
        warnings: sampleContext.warnings,
        passedChecks: [],
        recommendations: {
          crawl: sampleContext.crawl,
          integrations: sampleContext.integrations,
        },
      },
    });

    const enriched = await enrichAuditWithAiAnalysis(audit.id);
    assert(enriched.success === true, 'AI enrichment succeeds in mock mode');

    const stored = await prisma.auditResult.findUnique({
      where: { auditId: audit.id },
    });
    assert(
      stored?.recommendations?.crawl?.summary?.pagesCrawled === 2,
      'AI failure-safe: crawl data preserved'
    );
    assert(
      stored?.recommendations?.integrations?.pagespeed?.success === true,
      'AI failure-safe: integration data preserved'
    );
    assert(
      stored?.recommendations?.aiAnalysis?.success === true &&
        stored?.recommendations?.aiAnalysis?.mock === true,
      'Worker persistence path stores AI analysis'
    );

    // Simulate AI failure recording without wiping prior data
    integrationsConfig.useMocks = false;
    integrationsConfig.anthropic.apiKey = '';
    const failedEnrichment = await enrichAuditWithAiAnalysis(audit.id);
    integrationsConfig.useMocks = true;

    assert(failedEnrichment.success === false, 'AI failure recorded');
    const afterFail = await prisma.auditResult.findUnique({
      where: { auditId: audit.id },
    });
    assert(
      afterFail?.recommendations?.crawl?.summary?.pagesCrawled === 2 &&
        afterFail?.recommendations?.integrations?.pagespeed?.success === true,
      'AI failure does not lose crawler/integration results'
    );
    assert(
      afterFail?.recommendations?.aiAnalysis?.success === false &&
        afterFail?.recommendations?.aiAnalysis?.mock === false,
      'Failed AI envelope stored without pretending to be mock success'
    );

    // Full worker path
    const audit2 = await prisma.audit.create({
      data: {
        clientId: client.id,
        siteId: site.id,
        status: 'PENDING',
      },
    });
    created.auditIds.push(audit2.id);

    await enqueueAuditCrawlJob({
      auditId: audit2.id,
      siteId: site.id,
      clientId: client.id,
      crawlConfig: {
        maxPages: 1,
        maxDepth: 0,
        timeoutMs: 3000,
        allowPrivateNetworks: true,
      },
    });

    worker = createAuditWorker();

    const done = await waitFor(async () => {
      const result = await prisma.auditResult.findUnique({
        where: { auditId: audit2.id },
      });
      return Boolean(result?.recommendations?.aiAnalysis);
    });

    assert(done, 'Worker persistence includes AI analysis after crawl/integrations');
  } finally {
    if (worker) {
      try {
        await worker.close();
      } catch {
        // ignore
      }
    }
    await cleanup(created);
    await closeAuditQueue();
    await closeRedisConnection();
    await new Promise((resolve) => fixture.server.close(resolve));
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

run()
  .catch((error) => {
    console.error('AI analysis test runner failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
