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
    throw new Error(`Login failed for ${email}: ${res.status}`);
  }

  return res.json.data.accessToken;
}

async function ensureClientUser(clientId, email, password, name) {
  const passwordHash = await hashPassword(password);

  return prisma.user.upsert({
    where: { email },
    update: {
      passwordHash,
      role: 'CLIENT',
      clientId,
      name,
    },
    create: {
      name,
      email,
      passwordHash,
      role: 'CLIENT',
      clientId,
    },
  });
}

async function run() {
  console.log(`Running clients/sites tests against ${BASE_URL}\n`);

  const adminToken = await login(adminEmail, adminPassword);

  // Unauthenticated
  {
    const res = await request('/api/v1/clients');
    assert(res.status === 401, 'Unauthenticated list clients returns 401');
  }

  // Invalid input
  {
    const res = await request('/api/v1/clients', {
      method: 'POST',
      token: adminToken,
      body: {
        businessName: 'A',
        website: 'not-a-url',
        contactPerson: 'X',
        contactEmail: 'bad',
        industry: 'Y',
      },
    });
    assert(res.status === 400, 'Invalid client payload returns 400');
  }

  // Nonexistent client
  {
    const res = await request('/api/v1/clients/nonexistent_client_id', {
      token: adminToken,
    });
    assert(res.status === 404, 'Nonexistent client returns 404');
  }

  let clientA;
  let clientB;
  let siteA;

  // ADMIN create clients
  {
    const resA = await request('/api/v1/clients', {
      method: 'POST',
      token: adminToken,
      body: {
        businessName: 'Alpha Commerce',
        website: 'https://alpha-commerce.example',
        contactPerson: 'Alice Admin',
        contactEmail: 'alice@alpha-commerce.example',
        industry: 'E-commerce',
        status: 'ACTIVE',
      },
    });
    assert(resA.status === 201, 'ADMIN create client A returns 201');
    clientA = resA.json?.data;

    const resB = await request('/api/v1/clients', {
      method: 'POST',
      token: adminToken,
      body: {
        businessName: 'Beta Services',
        website: 'https://beta-services.example',
        contactPerson: 'Bob Beta',
        contactEmail: 'bob@beta-services.example',
        industry: 'Services',
      },
    });
    assert(resB.status === 201, 'ADMIN create client B returns 201');
    clientB = resB.json?.data;
  }

  // ADMIN list / view / update
  {
    const list = await request('/api/v1/clients', { token: adminToken });
    assert(list.status === 200, 'ADMIN list clients returns 200');
    assert(
      Array.isArray(list.json?.data) &&
        list.json.data.some((c) => c.id === clientA.id),
      'ADMIN list includes created client'
    );

    const view = await request(`/api/v1/clients/${clientA.id}`, {
      token: adminToken,
    });
    assert(view.status === 200, 'ADMIN view client returns 200');
    assert(view.json?.data?.businessName === 'Alpha Commerce', 'ADMIN view data');

    const update = await request(`/api/v1/clients/${clientA.id}`, {
      method: 'PATCH',
      token: adminToken,
      body: { industry: 'Retail' },
    });
    assert(update.status === 200, 'ADMIN update client returns 200');
    assert(update.json?.data?.industry === 'Retail', 'ADMIN update applied');
  }

  // ADMIN sites management
  {
    const create = await request(`/api/v1/clients/${clientA.id}/sites`, {
      method: 'POST',
      token: adminToken,
      body: { url: 'https://www.alpha-commerce.example/' },
    });
    assert(create.status === 201, 'ADMIN create site returns 201');
    assert(
      create.json?.data?.domain === 'alpha-commerce.example',
      'Site domain normalized from URL'
    );
    siteA = create.json?.data;

    const dup = await request(`/api/v1/clients/${clientA.id}/sites`, {
      method: 'POST',
      token: adminToken,
      body: { url: 'https://alpha-commerce.example/' },
    });
    assert(dup.status === 409, 'Duplicate site for same client returns 409');

    const list = await request(`/api/v1/clients/${clientA.id}/sites`, {
      token: adminToken,
    });
    assert(list.status === 200, 'ADMIN list sites returns 200');
    assert(
      Array.isArray(list.json?.data) && list.json.data.length >= 1,
      'ADMIN site list contains site'
    );

    const get = await request(`/api/v1/sites/${siteA.id}`, {
      token: adminToken,
    });
    assert(get.status === 200, 'ADMIN get site returns 200');

    const patch = await request(`/api/v1/sites/${siteA.id}`, {
      method: 'PATCH',
      token: adminToken,
      body: { url: 'https://shop.alpha-commerce.example/' },
    });
    assert(patch.status === 200, 'ADMIN update site returns 200');
    assert(
      patch.json?.data?.domain === 'shop.alpha-commerce.example',
      'ADMIN site domain updated'
    );
    siteA = patch.json?.data;

    const siteOnB = await request(`/api/v1/clients/${clientB.id}/sites`, {
      method: 'POST',
      token: adminToken,
      body: { url: 'https://www.beta-services.example/home' },
    });
    assert(siteOnB.status === 201, 'ADMIN create site on client B returns 201');
  }

  // Prepare CLIENT users linked to A and B
  const clientAUserEmail = 'owner.alpha@example.com';
  const clientAUserPassword = 'ClientA@12345';
  const clientBUserEmail = 'owner.beta@example.com';
  const clientBUserPassword = 'ClientB@12345';

  await ensureClientUser(
    clientA.id,
    clientAUserEmail,
    clientAUserPassword,
    'Alpha Owner'
  );
  await ensureClientUser(
    clientB.id,
    clientBUserEmail,
    clientBUserPassword,
    'Beta Owner'
  );

  const clientAToken = await login(clientAUserEmail, clientAUserPassword);
  const clientBToken = await login(clientBUserEmail, clientBUserPassword);

  // CLIENT permissions
  {
    const list = await request('/api/v1/clients', { token: clientAToken });
    assert(list.status === 403, 'CLIENT cannot list all clients');

    const own = await request(`/api/v1/clients/${clientA.id}`, {
      token: clientAToken,
    });
    assert(own.status === 200, 'CLIENT can view own client');

    const other = await request(`/api/v1/clients/${clientB.id}`, {
      token: clientAToken,
    });
    assert(other.status === 403, 'CLIENT cannot view another client');

    const create = await request('/api/v1/clients', {
      method: 'POST',
      token: clientAToken,
      body: {
        businessName: 'Hack Co',
        website: 'https://hack.example',
        contactPerson: 'Eve',
        contactEmail: 'eve@hack.example',
        industry: 'None',
      },
    });
    assert(create.status === 403, 'CLIENT cannot create clients');

    const update = await request(`/api/v1/clients/${clientA.id}`, {
      method: 'PATCH',
      token: clientAToken,
      body: { industry: 'Hacked' },
    });
    assert(update.status === 403, 'CLIENT cannot update clients');

    const del = await request(`/api/v1/clients/${clientA.id}`, {
      method: 'DELETE',
      token: clientAToken,
    });
    assert(del.status === 403, 'CLIENT cannot delete clients');

    const ownSites = await request(`/api/v1/clients/${clientA.id}/sites`, {
      token: clientAToken,
    });
    assert(ownSites.status === 200, 'CLIENT can view own sites');

    const otherSites = await request(`/api/v1/clients/${clientB.id}/sites`, {
      token: clientAToken,
    });
    assert(otherSites.status === 403, 'CLIENT cannot list another client sites');

    const otherSiteId = (
      await request(`/api/v1/clients/${clientB.id}/sites`, {
        token: adminToken,
      })
    ).json?.data?.[0]?.id;

    const foreignSite = await request(`/api/v1/sites/${otherSiteId}`, {
      token: clientAToken,
    });
    assert(
      foreignSite.status === 403,
      'CLIENT cannot access another client website'
    );

    const createSite = await request(`/api/v1/clients/${clientA.id}/sites`, {
      method: 'POST',
      token: clientAToken,
      body: { url: 'https://evil.alpha-commerce.example' },
    });
    assert(createSite.status === 403, 'CLIENT cannot create sites');
  }

  // ADMIN delete site then client (safe path)
  {
    // clientA has linked user -> delete should conflict
    const blocked = await request(`/api/v1/clients/${clientA.id}`, {
      method: 'DELETE',
      token: adminToken,
    });
    assert(
      blocked.status === 409,
      'ADMIN cannot delete client with linked users'
    );

    // Unlink user, delete sites, then delete clientA
    await prisma.user.update({
      where: { email: clientAUserEmail },
      data: { clientId: null },
    });

    const delSite = await request(`/api/v1/sites/${siteA.id}`, {
      method: 'DELETE',
      token: adminToken,
    });
    assert(delSite.status === 200, 'ADMIN delete site returns 200');

    const delClient = await request(`/api/v1/clients/${clientA.id}`, {
      method: 'DELETE',
      token: adminToken,
    });
    assert(delClient.status === 200, 'ADMIN delete client returns 200');
  }

  // Keep clientB for residual data; unlink and clean optional sites later
  await prisma.user.update({
    where: { email: clientBUserEmail },
    data: { clientId: null },
  });

  const clientBSites = await request(`/api/v1/clients/${clientB.id}/sites`, {
    token: adminToken,
  });

  for (const site of clientBSites.json?.data || []) {
    await request(`/api/v1/sites/${site.id}`, {
      method: 'DELETE',
      token: adminToken,
    });
  }

  await request(`/api/v1/clients/${clientB.id}`, {
    method: 'DELETE',
    token: adminToken,
  });

  console.log(`\nResult: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

run()
  .catch((error) => {
    console.error('Clients/sites test runner failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
