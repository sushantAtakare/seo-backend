import 'dotenv/config';
import prisma from '../src/config/prisma.js';
import { hashPassword } from '../src/utils/password.js';

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

async function request(path, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${BASE_URL}${path}`, {
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

async function cleanupFixtures(ids) {
  const { auditIds = [], siteIds = [], clientIds = [], userEmails = [] } = ids;

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
  console.log(`Running audits tests against ${BASE_URL}\n`);

  const adminToken = await login(adminEmail, adminPassword);
  const created = {
    auditIds: [],
    siteIds: [],
    clientIds: [],
    userEmails: [],
  };

  try {
    // Unauthenticated
    {
      const res = await request('/api/v1/audits');
      assert(res.status === 401, 'Unauthenticated list audits returns 401');
    }

    // Invalid input
    {
      const res = await request('/api/v1/audits', {
        method: 'POST',
        token: adminToken,
        body: {},
      });
      assert(res.status === 400, 'Missing siteId returns 400');

      const unsupported = await request('/api/v1/audits', {
        method: 'POST',
        token: adminToken,
        body: { siteId: 'x', crawlDepth: 5 },
      });
      assert(unsupported.status === 400, 'Unsupported config fields return 400');
    }

    // Nonexistent site
    {
      const res = await request('/api/v1/audits', {
        method: 'POST',
        token: adminToken,
        body: { siteId: 'missing_site_id' },
      });
      assert(res.status === 404, 'Nonexistent site returns 404');
    }

    // Seed clients + sites
    const clientA = await prisma.client.create({
      data: {
        businessName: 'Audit Alpha Co',
        website: 'https://audit-alpha.example',
        contactPerson: 'Alpha Contact',
        contactEmail: 'contact@audit-alpha.example',
        industry: 'SEO',
      },
    });
    const clientB = await prisma.client.create({
      data: {
        businessName: 'Audit Beta Co',
        website: 'https://audit-beta.example',
        contactPerson: 'Beta Contact',
        contactEmail: 'contact@audit-beta.example',
        industry: 'Marketing',
      },
    });
    created.clientIds.push(clientA.id, clientB.id);

    const siteA = await prisma.site.create({
      data: {
        clientId: clientA.id,
        domain: 'audit-alpha.example',
        url: 'https://audit-alpha.example/',
      },
    });
    const siteB = await prisma.site.create({
      data: {
        clientId: clientB.id,
        domain: 'audit-beta.example',
        url: 'https://audit-beta.example/',
      },
    });
    created.siteIds.push(siteA.id, siteB.id);

    const clientAEmail = 'audit.owner.alpha@example.com';
    const clientAPassword = 'AuditClientA@123';
    const clientBEmail = 'audit.owner.beta@example.com';
    const clientBPassword = 'AuditClientB@123';
    created.userEmails.push(clientAEmail, clientBEmail);

    await ensureClientUser(clientA.id, clientAEmail, clientAPassword, 'Alpha Owner');
    await ensureClientUser(clientB.id, clientBEmail, clientBPassword, 'Beta Owner');

    const clientAToken = await login(clientAEmail, clientAPassword);
    const clientBToken = await login(clientBEmail, clientBPassword);

    let adminAudit;
    let clientAudit;

    // ADMIN creates audit
    {
      const res = await request('/api/v1/audits', {
        method: 'POST',
        token: adminToken,
        body: { siteId: siteA.id },
      });
      assert(res.status === 201, 'ADMIN creates an audit');
      assert(res.json?.data?.status === 'PENDING', 'Created audit is PENDING');
      adminAudit = res.json.data;
      created.auditIds.push(adminAudit.id);
    }

    // CLIENT creates for own site
    {
      const res = await request('/api/v1/audits', {
        method: 'POST',
        token: clientAToken,
        body: { siteId: siteA.id },
      });
      assert(res.status === 201, 'CLIENT creates audit for own site');
      clientAudit = res.json.data;
      created.auditIds.push(clientAudit.id);
    }

    // CLIENT cannot create for another client site
    {
      const res = await request('/api/v1/audits', {
        method: 'POST',
        token: clientAToken,
        body: { siteId: siteB.id },
      });
      assert(
        res.status === 403,
        'CLIENT cannot create audit for another client site'
      );
    }

    // Create one for client B so list scoping can be verified
    {
      const res = await request('/api/v1/audits', {
        method: 'POST',
        token: adminToken,
        body: { siteId: siteB.id },
      });
      assert(res.status === 201, 'ADMIN creates audit for client B site');
      created.auditIds.push(res.json.data.id);
    }

    // ADMIN lists all
    {
      const res = await request('/api/v1/audits?limit=50', {
        token: adminToken,
      });
      assert(res.status === 200, 'ADMIN lists all audits');
      assert(
        Array.isArray(res.json?.data?.items) &&
          res.json.data.items.length >= 3,
        'ADMIN list includes multiple audits'
      );
      assert(
        res.json?.data?.pagination?.total >= 3,
        'ADMIN pagination total is set'
      );
    }

    // CLIENT sees only own
    {
      const res = await request('/api/v1/audits', { token: clientAToken });
      assert(res.status === 200, 'CLIENT lists own audits');
      const items = res.json?.data?.items || [];
      assert(
        items.length >= 1 && items.every((a) => a.clientId === clientA.id),
        'CLIENT list scoped to own client'
      );
      assert(
        !items.some((a) => a.clientId === clientB.id),
        'CLIENT list excludes other clients'
      );
    }

    // ADMIN view + update
    {
      const view = await request(`/api/v1/audits/${adminAudit.id}`, {
        token: adminToken,
      });
      assert(view.status === 200, 'ADMIN views audit');

      const badTransition = await request(`/api/v1/audits/${adminAudit.id}`, {
        method: 'PATCH',
        token: adminToken,
        body: { status: 'COMPLETED' },
      });
      assert(
        badTransition.status === 400,
        'Invalid status transition rejected'
      );

      const processing = await request(`/api/v1/audits/${adminAudit.id}`, {
        method: 'PATCH',
        token: adminToken,
        body: { status: 'PROCESSING' },
      });
      assert(processing.status === 200, 'ADMIN updates audit to PROCESSING');
      assert(
        processing.json?.data?.status === 'PROCESSING',
        'Audit status is PROCESSING'
      );

      const completed = await request(`/api/v1/audits/${adminAudit.id}`, {
        method: 'PATCH',
        token: adminToken,
        body: { status: 'COMPLETED', overallScore: 88 },
      });
      assert(completed.status === 200, 'ADMIN completes audit with score');
      assert(completed.json?.data?.overallScore === 88, 'overallScore saved');
    }

    // CLIENT cannot modify restricted fields / status
    {
      const res = await request(`/api/v1/audits/${clientAudit.id}`, {
        method: 'PATCH',
        token: clientAToken,
        body: { status: 'COMPLETED', overallScore: 100 },
      });
      assert(res.status === 403, 'CLIENT cannot modify audit status/fields');
    }

    // CLIENT cannot access another client's audit
    {
      const otherList = await request('/api/v1/audits', {
        token: clientBToken,
      });
      const otherAuditId = otherList.json?.data?.items?.[0]?.id;

      const res = await request(`/api/v1/audits/${otherAuditId}`, {
        token: clientAToken,
      });
      assert(
        res.status === 403,
        'CLIENT cannot access another client audit'
      );
    }

    // Nonexistent audit
    {
      const res = await request('/api/v1/audits/missing_audit_id', {
        token: adminToken,
      });
      assert(res.status === 404, 'Nonexistent audit returns 404');
    }

    // Attach linked result/report then ADMIN deletes safely
    {
      await prisma.auditResult.create({
        data: {
          auditId: adminAudit.id,
          technicalSeo: 80,
          onPageSeo: 80,
          performance: 80,
          mobileFriendliness: 80,
          contentQuality: 80,
          schemaMarkup: 80,
          criticalIssues: [],
          importantIssues: [],
          warnings: [],
          passedChecks: [],
          recommendations: [],
        },
      });

      await prisma.report.create({
        data: {
          auditId: adminAudit.id,
          status: 'READY',
          filePath: null,
        },
      });

      const del = await request(`/api/v1/audits/${adminAudit.id}`, {
        method: 'DELETE',
        token: adminToken,
      });
      assert(del.status === 200, 'ADMIN deletes audit safely');
      assert(del.json?.data?.removedResult === true, 'Linked result removed');
      assert(del.json?.data?.removedReport === true, 'Linked report removed');

      const gone = await request(`/api/v1/audits/${adminAudit.id}`, {
        token: adminToken,
      });
      assert(gone.status === 404, 'Deleted audit is not found');

      // keep remaining ids for cleanup (adminAudit already deleted)
      created.auditIds = created.auditIds.filter((id) => id !== adminAudit.id);
    }

    // CLIENT cannot delete
    {
      const res = await request(`/api/v1/audits/${clientAudit.id}`, {
        method: 'DELETE',
        token: clientAToken,
      });
      assert(res.status === 403, 'CLIENT cannot delete audits');
    }
  } finally {
    await cleanupFixtures(created);
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

run()
  .catch((error) => {
    console.error('Audits test runner failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
