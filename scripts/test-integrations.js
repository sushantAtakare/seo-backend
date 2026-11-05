import 'dotenv/config';
import prisma from '../src/config/prisma.js';
import integrationsConfig from '../src/config/integrations.js';
import { analyzePageSpeed } from '../src/modules/integrations/pagespeed/pagespeed.service.js';
import { analyzeSearchConsole } from '../src/modules/integrations/search-console/search-console.service.js';
import { analyzeDataForSeo } from '../src/modules/integrations/dataforseo/dataforseo.service.js';
import { validateSchemaMarkup } from '../src/modules/integrations/schema/schema.service.js';
import {
  runAuditIntegrations,
  enrichAuditWithIntegrations,
} from '../src/modules/integrations/integrations.service.js';
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

function isNormalized(response, source) {
  return (
    response &&
    response.source === source &&
    typeof response.success === 'boolean' &&
    typeof response.mock === 'boolean' &&
    typeof response.fetchedAt === 'string' &&
    Array.isArray(response.errors) &&
    Object.prototype.hasOwnProperty.call(response, 'data')
  );
}

async function waitFor(predicate, { timeoutMs = 25000, intervalMs = 250 } = {}) {
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
  <title>Integration Fixture</title>
  <meta name="description" content="Integration fixture page" />
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    "name": "Fixture Org",
    "url": "https://fixture.example"
  }
  </script>
  <script type="application/ld+json">
  { this is not valid json
  </script>
</head>
<body><h1>Integration Fixture</h1></body>
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
  console.log('Running integrations tests\n');

  assert(integrationsConfig.useMocks === true, 'USE_MOCKS=true');

  const pagespeed = await analyzePageSpeed('https://example.com/');
  assert(isNormalized(pagespeed, 'pagespeed'), 'Normalized PageSpeed response');
  assert(pagespeed.success === true && pagespeed.mock === true, 'PageSpeed mock results');
  assert(
    typeof pagespeed.data?.mobile?.scores?.performance === 'number' &&
      typeof pagespeed.data?.desktop?.scores?.performance === 'number',
    'PageSpeed includes mobile and desktop scores'
  );

  const gsc = await analyzeSearchConsole('https://example.com/', {
    startDate: '2026-10-01',
    endDate: '2026-10-31',
  });
  assert(isNormalized(gsc, 'search-console'), 'Normalized Search Console response');
  assert(gsc.success === true && gsc.mock === true, 'Search Console mock results');
  assert(
    Array.isArray(gsc.data?.topQueries) && Array.isArray(gsc.data?.topPages),
    'Search Console includes queries and pages'
  );

  const dfs = await analyzeDataForSeo('example.com');
  assert(isNormalized(dfs, 'dataforseo'), 'Normalized DataForSEO response');
  assert(dfs.success === true && dfs.mock === true, 'DataForSEO mock results');
  assert(
    dfs.data?.keywordInfo?.searchVolume > 0 &&
      Array.isArray(dfs.data?.competitors),
    'DataForSEO includes keyword and competitors'
  );

  const schemaOk = validateSchemaMarkup({
    html: `<script type="application/ld+json">{"@type":"Organization","name":"A","url":"https://a.test"}</script>`,
  });
  assert(schemaOk.success === true, 'Schema.org extraction succeeds');
  assert(
    schemaOk.data.detectedTypes.includes('Organization'),
    'Schema detects Organization type'
  );

  const schemaBad = validateSchemaMarkup({
    jsonLdBlocks: ['{ not-json'],
  });
  assert(
    schemaBad.data.issues.some((i) => i.code === 'INVALID_JSON_LD'),
    'Invalid JSON-LD detected'
  );

  // Missing credentials behavior when mocks disabled
  const previous = integrationsConfig.useMocks;
  integrationsConfig.useMocks = false;
  const missingPsi = await analyzePageSpeed('https://example.com/');
  assert(
    missingPsi.success === false &&
      missingPsi.errors.some((e) => /not configured/i.test(e)),
    'Missing credentials handled for PageSpeed'
  );
  const missingGsc = await analyzeSearchConsole('https://example.com/');
  assert(
    missingGsc.success === false &&
      missingGsc.errors.some((e) => /not configured/i.test(e)),
    'Missing credentials handled for Search Console'
  );
  const missingDfs = await analyzeDataForSeo('example.com');
  assert(
    missingDfs.success === false &&
      missingDfs.errors.some((e) => /not configured/i.test(e)),
    'Missing credentials handled for DataForSEO'
  );

  // Timeout / failure handling with bogus live mode + fake key
  integrationsConfig.pagespeed.apiKey = 'test-key';
  integrationsConfig.timeoutMs = 30;
  const timed = await analyzePageSpeed('https://example.invalid/');
  assert(
    timed.success === false && timed.errors.length > 0,
    'External API failure / timeout handling'
  );
  integrationsConfig.pagespeed.apiKey = '';
  integrationsConfig.timeoutMs = 15000;
  integrationsConfig.useMocks = previous;

  const bundle = await runAuditIntegrations({
    url: 'https://example.com/',
    domain: 'example.com',
    crawlResult: {
      pages: [
        {
          url: 'https://example.com/',
          jsonLdBlocks: [
            JSON.stringify({
              '@type': 'WebSite',
              name: 'Example',
              url: 'https://example.com/',
            }),
          ],
        },
      ],
    },
  });
  assert(bundle.pagespeed.success, 'Orchestrator PageSpeed ok');
  assert(bundle.searchConsole.success, 'Orchestrator Search Console ok');
  assert(bundle.dataforseo.success, 'Orchestrator DataForSEO ok');
  assert(bundle.schema.success, 'Orchestrator Schema ok');

  // Persistence + worker integration with local fixture
  const fixture = await startFixtureServer();
  const created = { auditIds: [], siteIds: [], clientIds: [] };
  let worker;

  try {
    const client = await prisma.client.create({
      data: {
        businessName: 'Integrations Co',
        website: 'https://integrations.example',
        contactPerson: 'Integration Owner',
        contactEmail: 'owner@integrations.example',
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
        status: 'PENDING',
      },
    });
    created.auditIds.push(audit.id);

    // Direct enrichment path with fake crawl result
    await prisma.auditResult.create({
      data: {
        auditId: audit.id,
        technicalSeo: 70,
        onPageSeo: 70,
        performance: 70,
        mobileFriendliness: 70,
        contentQuality: 70,
        schemaMarkup: 50,
        criticalIssues: [],
        importantIssues: [],
        warnings: [],
        passedChecks: [],
        recommendations: { crawl: { summary: { pagesCrawled: 1 }, pages: [] } },
      },
    });
    await prisma.audit.update({
      where: { id: audit.id },
      data: { status: 'COMPLETED', overallScore: 70 },
    });

    const enriched = await enrichAuditWithIntegrations(audit.id, {
      pages: [
        {
          url: site.url,
          jsonLdBlocks: [
            JSON.stringify({
              '@type': 'Organization',
              name: 'Integrations Co',
              url: 'https://integrations.example',
            }),
          ],
        },
      ],
    });

    assert(enriched.skipped === false, 'AuditResult enrichment runs');
    const stored = await prisma.auditResult.findUnique({
      where: { auditId: audit.id },
    });
    assert(
      stored?.recommendations?.integrations?.pagespeed?.mock === true,
      'AuditResult persistence stores integration mocks'
    );

    // Worker integration path
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
      const row = await prisma.audit.findUnique({ where: { id: audit2.id } });
      const result = await prisma.auditResult.findUnique({
        where: { auditId: audit2.id },
      });
      return (
        row?.status === 'COMPLETED' &&
        Boolean(result?.recommendations?.integrations)
      );
    }, { timeoutMs: 35000 });

    assert(done, 'Worker integration persists integrations after crawl');
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
    console.error('Integrations test runner failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
