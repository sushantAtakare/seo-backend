import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';
import prisma from '../src/config/prisma.js';
import { hashPassword } from '../src/utils/password.js';
import {
  assertSafePublicUrl,
  extractPageSeo,
  isPrivateIpAddress,
  normalizeUrl,
  parseRobotsTxt,
  isPathAllowedByRobots,
} from '../src/modules/crawler/crawler.utils.js';
import {
  crawlWebsite,
  safeFetch,
} from '../src/modules/crawler/crawler.service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, 'fixtures', 'crawler');
const BASE_URL = process.env.AUTH_TEST_BASE_URL || 'http://127.0.0.1:7000';
const adminEmail = process.env.ADMIN_EMAIL;
const adminPassword = process.env.ADMIN_PASSWORD;

if (!adminEmail || !adminPassword) {
  console.error('ADMIN_EMAIL and ADMIN_PASSWORD are required');
  process.exit(1);
}

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

async function request(apiPath, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${BASE_URL}${apiPath}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }

  return { status: response.status, json };
}

async function login(email, password) {
  const res = await request('/api/v1/auth/login', {
    method: 'POST',
    body: { email, password },
  });
  if (res.status !== 200) {
    throw new Error(`Login failed: ${JSON.stringify(res.json)}`);
  }
  return res.json.data.accessToken;
}

function startFixtureServer() {
  const home = fs.readFileSync(path.join(FIXTURES, 'home.html'), 'utf8');
  const about = fs.readFileSync(path.join(FIXTURES, 'about.html'), 'utf8');
  const noSeo = fs.readFileSync(path.join(FIXTURES, 'no-seo.html'), 'utf8');

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');

    if (url.pathname === '/robots.txt') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('User-agent: *\nDisallow: /private\nAllow: /\n');
      return;
    }

    if (url.pathname === '/redirect-private') {
      res.writeHead(302, { Location: 'http://127.0.0.1/secret' });
      res.end();
      return;
    }

    if (url.pathname === '/redirect-metadata') {
      res.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data' });
      res.end();
      return;
    }

    if (url.pathname === '/timeout') {
      // Intentionally hang until client aborts
      return;
    }

    if (url.pathname === '/binary') {
      res.writeHead(200, { 'Content-Type': 'application/pdf' });
      res.end('%PDF-fake');
      return;
    }

    if (url.pathname === '/private') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><title>Secret</title></html>');
      return;
    }

    if (url.pathname === '/about') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(about);
      return;
    }

    if (url.pathname === '/no-seo') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(noSeo);
      return;
    }

    if (url.pathname === '/' || url.pathname === '/home') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(home);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end('<html><title>Not Found</title><h1>Missing</h1></html>');
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port, origin: `http://127.0.0.1:${port}` });
    });
  });
}

async function ensureClientUser(clientId, email, password, name) {
  const passwordHash = await hashPassword(password);
  return prisma.user.upsert({
    where: { email },
    update: { passwordHash, role: 'CLIENT', clientId, name },
    create: { name, email, passwordHash, role: 'CLIENT', clientId },
  });
}

async function cleanup(ids) {
  const { auditIds = [], siteIds = [], clientIds = [], userEmails = [] } = ids;

  if (auditIds.length) {
    await prisma.report.deleteMany({ where: { auditId: { in: auditIds } } });
    await prisma.auditResult.deleteMany({ where: { auditId: { in: auditIds } } });
    await prisma.audit.deleteMany({ where: { id: { in: auditIds } } });
  }
  if (siteIds.length) {
    await prisma.site.deleteMany({ where: { id: { in: siteIds } } });
  }
  if (userEmails.length) {
    await prisma.refreshToken.deleteMany({
      where: { user: { email: { in: userEmails } } },
    });
    await prisma.user.deleteMany({ where: { email: { in: userEmails } } });
  }
  if (clientIds.length) {
    await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
  }
}

async function run() {
  console.log(`Running crawler tests (API ${BASE_URL})\n`);

  const fixture = await startFixtureServer();
  const created = { auditIds: [], siteIds: [], clientIds: [], userEmails: [] };

  try {
    // --- Unit / SSRF helpers ---
    assert(isPrivateIpAddress('127.0.0.1'), 'Detects loopback IPv4 as private');
    assert(isPrivateIpAddress('10.0.0.5'), 'Detects 10.x as private');
    assert(isPrivateIpAddress('192.168.1.1'), 'Detects 192.168.x as private');
    assert(isPrivateIpAddress('169.254.169.254'), 'Detects link-local/metadata IP');
    assert(isPrivateIpAddress('::1'), 'Detects IPv6 loopback');
    assert(!isPrivateIpAddress('8.8.8.8'), 'Allows public IPv4');

    {
      let blocked = false;
      try {
        await assertSafePublicUrl('http://127.0.0.1/');
      } catch {
        blocked = true;
      }
      assert(blocked, 'SSRF blocks localhost URL');
    }

    {
      let blocked = false;
      try {
        await assertSafePublicUrl('http://169.254.169.254/latest/meta-data');
      } catch {
        blocked = true;
      }
      assert(blocked, 'SSRF blocks metadata IP URL');
    }

    {
      let blocked = false;
      try {
        await assertSafePublicUrl('file:///etc/passwd');
      } catch {
        blocked = true;
      }
      assert(blocked, 'Rejects non-http(s) file URL');
    }

    assert(
      normalizeUrl('https://Example.com/a#section') === 'https://example.com/a',
      'Normalizes URL and strips fragment'
    );

    const robots = parseRobotsTxt('User-agent: *\nDisallow: /private\nAllow: /\n');
    assert(!isPathAllowedByRobots('/private', robots), 'robots.txt disallows /private');
    assert(isPathAllowedByRobots('/home', robots), 'robots.txt allows /home');

    // --- Extraction from fixture HTML ---
    const homeHtml = fs.readFileSync(path.join(FIXTURES, 'home.html'), 'utf8');
    const extracted = extractPageSeo(homeHtml, `${fixture.origin}/`);
    assert(extracted.title === 'Fixture Home Title', 'Title extraction');
    assert(
      extracted.metaDescription === 'Fixture home meta description',
      'Meta description extraction'
    );
    assert(extracted.headings.h1.includes('Primary Home Heading'), 'H1 extraction');
    assert(extracted.headings.h2.length === 1, 'H2 extraction');
    assert(
      extracted.internalLinks.some((l) => l.endsWith('/about')),
      'Internal link collection'
    );
    assert(
      extracted.externalLinks.some((l) => l.includes('external.example')),
      'External link collection'
    );
    assert(extracted.imagesMissingAlt.length >= 1, 'Missing image alt detection');
    assert(extracted.missingTitle === false, 'Title present is not flagged missing');

    const noSeo = extractPageSeo(
      fs.readFileSync(path.join(FIXTURES, 'no-seo.html'), 'utf8'),
      `${fixture.origin}/no-seo`
    );
    assert(noSeo.missingTitle === true, 'Missing title detection');
    assert(noSeo.missingMetaDescription === true, 'Missing description detection');
    assert(noSeo.missingH1 === true, 'Missing H1 detection');

    // --- In-process crawl against local fixture ---
    const crawl = await crawlWebsite(`${fixture.origin}/`, {
      maxPages: 5,
      maxDepth: 1,
      timeoutMs: 3000,
      allowPrivateNetworks: true,
    });

    assert(crawl.summary.pagesCrawled >= 2, 'Valid website crawling visits multiple pages');
    assert(crawl.summary.totalInternalLinks >= 1, 'Crawl aggregates internal links');
    assert(crawl.summary.totalExternalLinks >= 1, 'Crawl aggregates external links');
    assert(
      crawl.pages.every((p) => p.url && !p.url.includes('#')),
      'Duplicate URL / fragment handling keeps normalized URLs'
    );
    assert(
      crawl.summary.duplicates.duplicateTitles.length >= 1,
      'Detects duplicate titles across pages'
    );
    assert(
      !crawl.pages.some((p) => (p.url || '').includes('/private')),
      'Respects robots.txt disallow'
    );

    // Timeout handling
    {
      let timedOut = false;
      try {
        await safeFetch(`${fixture.origin}/timeout`, {
          timeoutMs: 300,
          maxRedirects: 2,
          maxResponseBytes: 10000,
          allowPrivateNetworks: true,
        });
      } catch (error) {
        timedOut = error.statusCode === 408 || /timed out/i.test(error.message);
      }
      assert(timedOut, 'Timeout handling');
    }

    // Unsupported content type
    {
      let rejected = false;
      try {
        await safeFetch(`${fixture.origin}/binary`, {
          timeoutMs: 2000,
          maxRedirects: 2,
          maxResponseBytes: 10000,
          allowPrivateNetworks: true,
        });
      } catch (error) {
        rejected = /content type/i.test(error.message);
      }
      assert(rejected, 'Unsupported content types rejected');
    }

    // Redirect to private IP rejection (even when private origin allowed for fixture)
    {
      let rejected = false;
      try {
        await safeFetch(`${fixture.origin}/redirect-metadata`, {
          timeoutMs: 2000,
          maxRedirects: 3,
          maxResponseBytes: 10000,
          allowPrivateNetworks: true,
        });
      } catch (error) {
        rejected = /not allowed/i.test(error.message);
      }
      assert(rejected, 'Redirect to private/metadata IP rejected');
    }

    // --- API auth / RBAC / SSRF ---
    const unauth = await request('/api/v1/audits/does-not-exist/crawl', {
      method: 'POST',
      body: {},
    });
    assert(unauth.status === 401, 'Authentication required for crawl');

    const adminToken = await login(adminEmail, adminPassword);

    const missing = await request('/api/v1/audits/missing_audit_id/crawl', {
      method: 'POST',
      token: adminToken,
      body: { maxPages: 1 },
    });
    assert(missing.status === 404, 'Nonexistent audit IDs return 404');

    const clientA = await prisma.client.create({
      data: {
        businessName: 'Crawl Alpha',
        website: 'https://crawl-alpha.example',
        contactPerson: 'Alpha',
        contactEmail: 'alpha@crawl-alpha.example',
        industry: 'SEO',
      },
    });
    const clientB = await prisma.client.create({
      data: {
        businessName: 'Crawl Beta',
        website: 'https://crawl-beta.example',
        contactPerson: 'Beta',
        contactEmail: 'beta@crawl-beta.example',
        industry: 'SEO',
      },
    });
    created.clientIds.push(clientA.id, clientB.id);

    // Site pointing at localhost for SSRF API test
    const ssrfSite = await prisma.site.create({
      data: {
        clientId: clientA.id,
        domain: '127.0.0.1',
        url: `${fixture.origin}/`,
      },
    });
    created.siteIds.push(ssrfSite.id);

    const ssrfAudit = await prisma.audit.create({
      data: {
        clientId: clientA.id,
        siteId: ssrfSite.id,
        status: 'PENDING',
      },
    });
    created.auditIds.push(ssrfAudit.id);

    const ssrfRes = await request(`/api/v1/audits/${ssrfAudit.id}/crawl`, {
      method: 'POST',
      token: adminToken,
      body: { maxPages: 1, maxDepth: 0 },
    });
    assert(
      ssrfRes.status === 400,
      'API SSRF protection blocks localhost crawl before queueing',
      `status=${ssrfRes.status} message=${ssrfRes.json?.message}`
    );

    // Ownership fixtures with public-looking URL that still fails DNS or we only test ownership
    const publicishSiteA = await prisma.site.create({
      data: {
        clientId: clientA.id,
        domain: 'crawl-owner-a.example',
        url: 'https://crawl-owner-a.example/',
      },
    });
    const publicishSiteB = await prisma.site.create({
      data: {
        clientId: clientB.id,
        domain: 'crawl-owner-b.example',
        url: 'https://crawl-owner-b.example/',
      },
    });
    created.siteIds.push(publicishSiteA.id, publicishSiteB.id);

    const auditA = await prisma.audit.create({
      data: { clientId: clientA.id, siteId: publicishSiteA.id, status: 'PENDING' },
    });
    const auditB = await prisma.audit.create({
      data: { clientId: clientB.id, siteId: publicishSiteB.id, status: 'PENDING' },
    });
    created.auditIds.push(auditA.id, auditB.id);

    const emailA = 'crawl.owner.a@example.com';
    const emailB = 'crawl.owner.b@example.com';
    created.userEmails.push(emailA, emailB);
    await ensureClientUser(clientA.id, emailA, 'CrawlClientA@123', 'Crawl A');
    await ensureClientUser(clientB.id, emailB, 'CrawlClientB@123', 'Crawl B');
    const tokenA = await login(emailA, 'CrawlClientA@123');
    const tokenB = await login(emailB, 'CrawlClientB@123');

    const clientForbidden = await request(`/api/v1/audits/${auditB.id}/crawl`, {
      method: 'POST',
      token: tokenA,
      body: { maxPages: 1 },
    });
    assert(
      clientForbidden.status === 403,
      'CLIENT ownership restrictions block other audits'
    );

    // ADMIN can attempt crawl (URL safety may reject fake domains before queue)
    const adminAttempt = await request(`/api/v1/audits/${auditA.id}/crawl`, {
      method: 'POST',
      token: adminToken,
      body: { maxPages: 1, maxDepth: 0 },
    });
    assert(
      [202, 400].includes(adminAttempt.status),
      'ADMIN authorization can invoke crawl endpoint',
      `status=${adminAttempt.status}`
    );

    // CLIENT can invoke own audit crawl endpoint
    // Reset audit if previous attempt left it PROCESSING without a job
    await prisma.audit.update({
      where: { id: auditA.id },
      data: { status: 'PENDING' },
    });

    const clientOwn = await request(`/api/v1/audits/${auditA.id}/crawl`, {
      method: 'POST',
      token: tokenA,
      body: { maxPages: 1, maxDepth: 0 },
    });
    assert(
      [202, 400, 409].includes(clientOwn.status) && clientOwn.status !== 403,
      'CLIENT can access own audit crawl endpoint',
      `status=${clientOwn.status}`
    );

    // Invalid URL already covered; invalid body
    const invalidBody = await request(`/api/v1/audits/${auditA.id}/crawl`, {
      method: 'POST',
      token: adminToken,
      body: { maxPages: 999, hacker: true },
    });
    assert(invalidBody.status === 400, 'Invalid crawl config rejected');

  } finally {
    await cleanup(created);
    await new Promise((resolve) => fixture.server.close(resolve));
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

run()
  .catch((error) => {
    console.error('Crawler test runner failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
