import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import prisma from '../src/config/prisma.js';
import { hashPassword } from '../src/utils/password.js';
import { generateReportForAudit } from '../src/modules/reports/reports.service.js';
import { generateReportPdf } from '../src/modules/reports/reports.pdf.js';

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

async function request(pathName, { method = 'GET', body, token, raw = false } = {}) {
  const headers = {};

  if (!raw) {
    headers['Content-Type'] = 'application/json';
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${BASE_URL}${pathName}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (raw) {
    const buffer = Buffer.from(await response.arrayBuffer());
    return {
      status: response.status,
      headers: response.headers,
      buffer,
      contentType: response.headers.get('content-type'),
    };
  }

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
    throw new Error(`Login failed for ${email}: ${JSON.stringify(res.json)}`);
  }

  return res.json.data.accessToken;
}

async function ensureClientUser(clientId, email, password, name) {
  const passwordHash = await hashPassword(password);

  return prisma.user.upsert({
    where: { email },
    update: { passwordHash, role: 'CLIENT', clientId, name },
    create: { name, email, passwordHash, role: 'CLIENT', clientId },
  });
}

function mockAuditResultPayload() {
  return {
    technicalSeo: 72,
    onPageSeo: 68,
    performance: 75,
    mobileFriendliness: 80,
    contentQuality: 70,
    schemaMarkup: 65,
    criticalIssues: [
      {
        code: 'MISSING_H1',
        message: 'Page is missing an H1 heading',
        url: 'https://reports-fixture.example/about',
      },
    ],
    importantIssues: [
      {
        code: 'IMAGES_MISSING_ALT',
        message: '2 image(s) missing alt text',
        url: 'https://reports-fixture.example/',
      },
    ],
    warnings: [
      {
        code: 'DUPLICATE_TITLE',
        message: 'Duplicate title across 2 pages',
        urls: [
          'https://reports-fixture.example/',
          'https://reports-fixture.example/about',
        ],
      },
    ],
    passedChecks: [
      {
        code: 'HAS_TITLE',
        message: 'Homepage includes a title tag',
      },
    ],
    recommendations: {
      crawl: {
        summary: {
          pagesCrawled: 2,
          totalInternalLinks: 4,
          totalExternalLinks: 1,
        },
        pages: [
          {
            url: 'https://reports-fixture.example/',
            title: 'Reports Fixture',
            missingH1: false,
          },
          {
            url: 'https://reports-fixture.example/about',
            title: 'Reports Fixture',
            missingH1: true,
          },
        ],
      },
      integrations: {
        pagespeed: {
          success: true,
          mock: true,
          data: {
            mobile: {
              scores: {
                performance: 71,
                accessibility: 92,
                bestPractices: 88,
                seo: 93,
              },
              coreWebVitals: {
                lcpMs: 2900,
                cls: 0.08,
                inpMs: 190,
                fcpMs: 1700,
                ttfbMs: 420,
              },
            },
            desktop: {
              scores: {
                performance: 86,
                accessibility: 94,
                bestPractices: 90,
                seo: 95,
              },
              coreWebVitals: {
                lcpMs: 1800,
                cls: 0.05,
                inpMs: 120,
                fcpMs: 1100,
                ttfbMs: 380,
              },
            },
          },
        },
        searchConsole: {
          success: false,
          mock: true,
          errors: ['not configured'],
        },
        dataforseo: {
          success: true,
          mock: true,
          data: { keywordInfo: { keywordDifficulty: 48 } },
        },
        schema: {
          success: true,
          mock: false,
          data: {
            detectedTypes: ['Organization'],
            score: 80,
            issues: [
              {
                severity: 'warning',
                code: 'MISSING_SAME_AS',
                message: 'Organization schema is missing sameAs links',
              },
            ],
          },
        },
      },
      aiAnalysis: {
        success: true,
        mock: true,
        data: {
          overallAssessment:
            'SEO posture is moderate based on available crawl and integration evidence.',
          overallScore: 70,
          issues: [
            {
              priority: 'critical',
              title: 'Missing H1 on about page',
              whyItMatters: 'H1 headings clarify page topic for users and crawlers.',
              suggestedFix: 'Add a descriptive H1 to /about',
              affectedUrls: ['https://reports-fixture.example/about'],
            },
            {
              priority: 'high',
              title: 'Images missing alt text',
              whyItMatters: 'Alt text improves accessibility and image SEO.',
              suggestedFix: 'Add meaningful alt attributes',
              affectedUrls: ['https://reports-fixture.example/'],
            },
            {
              priority: 'medium',
              title: 'Duplicate titles',
              whyItMatters: 'Unique titles help ranking and CTR.',
              suggestedFix: 'Differentiate page titles',
              affectedUrls: [
                'https://reports-fixture.example/',
                'https://reports-fixture.example/about',
              ],
            },
            {
              priority: 'low',
              title: 'Expand internal linking',
              whyItMatters: 'Stronger internal links distribute equity.',
              suggestedFix: 'Add contextual links between key pages',
              affectedUrls: ['https://reports-fixture.example/'],
            },
          ],
          recommendations: [
            {
              id: 'rec-1',
              priority: 'critical',
              action: 'Add an H1 heading on the about page',
              rationale: 'Critical on-page signal is missing.',
              affectedUrls: ['https://reports-fixture.example/about'],
            },
            {
              id: 'rec-2',
              priority: 'high',
              action: 'Provide alt text for images',
              rationale: 'Improves accessibility and relevance.',
              affectedUrls: ['https://reports-fixture.example/'],
            },
          ],
          positiveObservations: [
            'Homepage includes a title tag.',
            'Organization schema was detected.',
          ],
          prioritySummary: {
            critical: 1,
            high: 1,
            medium: 1,
            low: 1,
          },
        },
      },
    },
  };
}

async function cleanupFixtures(ids) {
  const {
    auditIds = [],
    siteIds = [],
    clientIds = [],
    userEmails = [],
    reportPaths = [],
  } = ids;

  for (const filePath of reportPaths) {
    try {
      await fs.unlink(filePath);
    } catch {
      // ignore
    }
  }

  if (auditIds.length) {
    await prisma.report.deleteMany({ where: { auditId: { in: auditIds } } });
    await prisma.auditResult.deleteMany({
      where: { auditId: { in: auditIds } },
    });
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
  console.log(`Running reports tests against ${BASE_URL}\n`);

  const adminToken = await login(adminEmail, adminPassword);
  const created = {
    auditIds: [],
    siteIds: [],
    clientIds: [],
    userEmails: [],
    reportPaths: [],
  };

  try {
    // Unauthenticated
    {
      const res = await request('/api/v1/reports');
      assert(res.status === 401, 'Unauthenticated list reports returns 401');
    }

    // Seed clients + sites + audits with mock completed results
    const clientA = await prisma.client.create({
      data: {
        businessName: 'Reports Alpha Co',
        website: 'https://reports-alpha.example',
        contactPerson: 'Alpha Owner',
        contactEmail: 'owner@reports-alpha.example',
        industry: 'Marketing',
      },
    });
    created.clientIds.push(clientA.id);

    const clientB = await prisma.client.create({
      data: {
        businessName: 'Reports Beta Co',
        website: 'https://reports-beta.example',
        contactPerson: 'Beta Owner',
        contactEmail: 'owner@reports-beta.example',
        industry: 'Retail',
      },
    });
    created.clientIds.push(clientB.id);

    const siteA = await prisma.site.create({
      data: {
        clientId: clientA.id,
        domain: 'reports-fixture.example',
        url: 'https://reports-fixture.example/',
      },
    });
    created.siteIds.push(siteA.id);

    const siteB = await prisma.site.create({
      data: {
        clientId: clientB.id,
        domain: 'reports-beta.example',
        url: 'https://reports-beta.example/',
      },
    });
    created.siteIds.push(siteB.id);

    const clientAEmail = 'client-reports-a@seo.local';
    const clientBEmail = 'client-reports-b@seo.local';
    const clientAPassword = 'ClientReportsA!234';
    const clientBPassword = 'ClientReportsB!234';
    created.userEmails.push(clientAEmail, clientBEmail);

    await ensureClientUser(
      clientA.id,
      clientAEmail,
      clientAPassword,
      'Reports Client A'
    );
    await ensureClientUser(
      clientB.id,
      clientBEmail,
      clientBPassword,
      'Reports Client B'
    );

    const clientAToken = await login(clientAEmail, clientAPassword);
    const clientBToken = await login(clientBEmail, clientBPassword);

    const completedAudit = await prisma.audit.create({
      data: {
        clientId: clientA.id,
        siteId: siteA.id,
        status: 'COMPLETED',
        overallScore: 72,
        startedAt: new Date(),
        completedAt: new Date(),
      },
    });
    created.auditIds.push(completedAudit.id);

    await prisma.auditResult.create({
      data: {
        auditId: completedAudit.id,
        ...mockAuditResultPayload(),
      },
    });

    const pendingAudit = await prisma.audit.create({
      data: {
        clientId: clientA.id,
        siteId: siteA.id,
        status: 'PENDING',
      },
    });
    created.auditIds.push(pendingAudit.id);

    const incompleteAudit = await prisma.audit.create({
      data: {
        clientId: clientA.id,
        siteId: siteA.id,
        status: 'COMPLETED',
        overallScore: 50,
        completedAt: new Date(),
      },
    });
    created.auditIds.push(incompleteAudit.id);
    // COMPLETED but no AuditResult

    const otherClientAudit = await prisma.audit.create({
      data: {
        clientId: clientB.id,
        siteId: siteB.id,
        status: 'COMPLETED',
        overallScore: 60,
        completedAt: new Date(),
      },
    });
    created.auditIds.push(otherClientAudit.id);

    await prisma.auditResult.create({
      data: {
        auditId: otherClientAudit.id,
        ...mockAuditResultPayload(),
      },
    });

    // Reject incomplete / invalid audits
    {
      const pendingRes = await request(
        `/api/v1/audits/${pendingAudit.id}/reports`,
        { method: 'POST', token: adminToken }
      );
      assert(
        pendingRes.status === 400,
        'Reject report for PENDING audit',
        JSON.stringify(pendingRes.json)
      );

      const noResultRes = await request(
        `/api/v1/audits/${incompleteAudit.id}/reports`,
        { method: 'POST', token: adminToken }
      );
      assert(
        noResultRes.status === 400,
        'Reject report for audit without results',
        JSON.stringify(noResultRes.json)
      );

      const missingAudit = await request(
        '/api/v1/audits/missing_audit_id/reports',
        { method: 'POST', token: adminToken }
      );
      assert(missingAudit.status === 404, 'Reject report for missing audit');
    }

    // Admin generate report
    let adminReportId = null;
    {
      const res = await request(
        `/api/v1/audits/${completedAudit.id}/reports`,
        { method: 'POST', token: adminToken }
      );
      assert(
        res.status === 201 && res.json?.data?.status === 'COMPLETED',
        'Admin can generate report for completed audit',
        JSON.stringify(res.json)
      );
      adminReportId = res.json?.data?.id;
      if (res.json?.data?.filePath) {
        created.reportPaths.push(res.json.data.filePath);
      }

      const exists =
        res.json?.data?.filePath &&
        (await fs
          .access(res.json.data.filePath)
          .then(() => true)
          .catch(() => false));
      assert(exists === true, 'Generated PDF file exists on disk');
    }

    // Client ownership: can generate for own audit
    {
      const res = await request(
        `/api/v1/audits/${completedAudit.id}/reports`,
        { method: 'POST', token: clientAToken }
      );
      assert(
        res.status === 201 && res.json?.data?.status === 'COMPLETED',
        'Client can regenerate report for own audit',
        JSON.stringify(res.json)
      );
      if (res.json?.data?.filePath) {
        created.reportPaths.push(res.json.data.filePath);
      }
      adminReportId = res.json?.data?.id || adminReportId;
    }

    // Client cannot generate for another client's audit
    {
      const res = await request(
        `/api/v1/audits/${otherClientAudit.id}/reports`,
        { method: 'POST', token: clientAToken }
      );
      assert(
        res.status === 403,
        'Client cannot generate report for another client audit',
        JSON.stringify(res.json)
      );
    }

    // Admin can generate for any client
    let otherReportId = null;
    {
      const res = await request(
        `/api/v1/audits/${otherClientAudit.id}/reports`,
        { method: 'POST', token: adminToken }
      );
      assert(
        res.status === 201,
        'Admin can generate report for any client',
        JSON.stringify(res.json)
      );
      otherReportId = res.json?.data?.id;
      if (res.json?.data?.filePath) {
        created.reportPaths.push(res.json.data.filePath);
      }
    }

    // List + filter
    {
      const listAdmin = await request('/api/v1/reports?limit=50', {
        token: adminToken,
      });
      assert(
        listAdmin.status === 200 &&
          Array.isArray(listAdmin.json?.data?.items) &&
          listAdmin.json.data.items.some((r) => r.id === adminReportId),
        'Admin list reports includes generated report'
      );

      const listClientA = await request('/api/v1/reports', {
        token: clientAToken,
      });
      assert(
        listClientA.status === 200 &&
          listClientA.json.data.items.every(
            (r) => r.audit?.clientId === clientA.id
          ) &&
          !listClientA.json.data.items.some((r) => r.id === otherReportId),
        'Client list is scoped to own client'
      );

      const filterAudit = await request(
        `/api/v1/reports?auditId=${completedAudit.id}`,
        { token: adminToken }
      );
      assert(
        filterAudit.status === 200 &&
          filterAudit.json.data.items.every(
            (r) => r.auditId === completedAudit.id
          ),
        'Filter reports by auditId'
      );
    }

    // Detail
    {
      const detail = await request(`/api/v1/reports/${adminReportId}`, {
        token: adminToken,
      });
      assert(
        detail.status === 200 &&
          detail.json?.data?.id === adminReportId &&
          detail.json.data.fileAvailable === true,
        'Admin can retrieve report details'
      );

      const clientDetail = await request(`/api/v1/reports/${adminReportId}`, {
        token: clientAToken,
      });
      assert(
        clientDetail.status === 200,
        'Owning client can retrieve report details'
      );

      const forbidden = await request(`/api/v1/reports/${otherReportId}`, {
        token: clientAToken,
      });
      assert(
        forbidden.status === 403,
        'Client cannot retrieve another client report'
      );

      const invalid = await request('/api/v1/reports/missing_report_id', {
        token: adminToken,
      });
      assert(invalid.status === 404, 'Invalid report id returns 404');
    }

    // PDF download
    {
      const download = await request(
        `/api/v1/reports/${adminReportId}/download`,
        { token: adminToken, raw: true }
      );
      assert(
        download.status === 200 &&
          String(download.contentType || '').includes('application/pdf') &&
          download.buffer.length > 500 &&
          download.buffer.subarray(0, 4).toString() === '%PDF',
        'Admin can download valid PDF'
      );

      const clientDownload = await request(
        `/api/v1/reports/${adminReportId}/download`,
        { token: clientAToken, raw: true }
      );
      assert(
        clientDownload.status === 200 &&
          clientDownload.buffer.subarray(0, 4).toString() === '%PDF',
        'Owning client can download PDF'
      );

      const forbiddenDownload = await request(
        `/api/v1/reports/${otherReportId}/download`,
        { token: clientAToken, raw: true }
      );
      assert(
        forbiddenDownload.status === 403,
        'Client cannot download another client PDF'
      );
    }

    // Missing PDF file handling
    {
      const report = await prisma.report.findUnique({
        where: { id: adminReportId },
      });
      const originalPath = report.filePath;
      if (originalPath) {
        await fs.unlink(originalPath).catch(() => {});
      }

      const detail = await request(`/api/v1/reports/${adminReportId}`, {
        token: adminToken,
      });
      assert(
        detail.status === 200 && detail.json.data.fileAvailable === false,
        'Detail marks missing PDF as unavailable'
      );

      const download = await request(
        `/api/v1/reports/${adminReportId}/download`,
        { token: adminToken }
      );
      assert(
        download.status === 404,
        'Download missing PDF returns 404',
        JSON.stringify(download.json)
      );

      // Restore by regenerating
      const regen = await request(
        `/api/v1/audits/${completedAudit.id}/reports`,
        { method: 'POST', token: adminToken }
      );
      assert(regen.status === 201, 'Regenerate report after missing PDF');
      if (regen.json?.data?.filePath) {
        created.reportPaths.push(regen.json.data.filePath);
      }
      adminReportId = regen.json?.data?.id || adminReportId;
    }

    // PDF generation failure handling (direct service + module)
    {
      const previousExec = process.env.PUPPETEER_EXECUTABLE_PATH;
      const bogusChrome = path.join(
        process.cwd(),
        'tmp',
        'definitely-missing-chrome-binary.exe'
      );
      await fs.mkdir(path.dirname(bogusChrome), { recursive: true });
      process.env.PUPPETEER_EXECUTABLE_PATH = bogusChrome;

      let pdfFailed = false;
      try {
        await generateReportPdf('failure-test', {
          generatedAt: new Date().toISOString(),
          websiteUrl: 'https://example.com',
          domain: 'example.com',
          overallScore: null,
          auditSummary: {},
          pageSpeed: { mobile: {}, desktop: {} },
          coreWebVitals: null,
          crawlFindings: [],
          schemaFindings: null,
          aiAnalysis: { recommendations: [] },
          priorities: { critical: [], high: [], medium: [], low: [] },
          positiveObservations: [],
        });
      } catch {
        pdfFailed = true;
      }

      assert(pdfFailed, 'PDF generation fails with invalid Chromium path');

      const failAudit = await prisma.audit.create({
        data: {
          clientId: clientA.id,
          siteId: siteA.id,
          status: 'COMPLETED',
          overallScore: 55,
          completedAt: new Date(),
        },
      });
      created.auditIds.push(failAudit.id);

      await prisma.auditResult.create({
        data: {
          auditId: failAudit.id,
          ...mockAuditResultPayload(),
        },
      });

      let serviceFailed = false;
      try {
        await generateReportForAudit(
          { role: 'ADMIN', clientId: null },
          failAudit.id
        );
      } catch (error) {
        serviceFailed = /PDF generation failed/i.test(error.message);
      }

      const failedReport = await prisma.report.findUnique({
        where: { auditId: failAudit.id },
      });

      assert(
        serviceFailed && failedReport?.status === 'FAILED',
        'Service marks report FAILED when PDF generation errors'
      );

      if (previousExec === undefined) {
        delete process.env.PUPPETEER_EXECUTABLE_PATH;
      } else {
        process.env.PUPPETEER_EXECUTABLE_PATH = previousExec;
      }
    }
  } catch (error) {
    failed += 1;
    console.error('FAIL  Unexpected test error —', error);
  } finally {
    await cleanupFixtures(created);
    await prisma.$disconnect();
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
