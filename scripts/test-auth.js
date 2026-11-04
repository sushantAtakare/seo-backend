import 'dotenv/config';
import prisma from '../src/config/prisma.js';
import { hashPassword } from '../src/utils/password.js';

const BASE_URL = process.env.AUTH_TEST_BASE_URL || 'http://127.0.0.1:7000';
const adminEmail = process.env.ADMIN_EMAIL;
const adminPassword = process.env.ADMIN_PASSWORD;

if (!adminEmail || !adminPassword) {
  console.error('ADMIN_EMAIL and ADMIN_PASSWORD are required for auth tests');
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
  const headers = {
    'Content-Type': 'application/json',
  };

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

function hasSensitiveLeak(payload) {
  const serialized = JSON.stringify(payload ?? {});
  return (
    serialized.includes('passwordHash') ||
    serialized.includes('"password"') ||
    /"tokenHash"/.test(serialized)
  );
}

async function ensureClientUser() {
  const client = await prisma.client.upsert({
    where: { id: 'auth_test_client_fixed' },
    update: {},
    create: {
      id: 'auth_test_client_fixed',
      businessName: 'Auth Test Client',
      website: 'https://example.com',
      contactPerson: 'Test Contact',
      contactEmail: 'client.contact@example.com',
      industry: 'Technology',
      status: 'ACTIVE',
    },
  });

  const email = 'client.user@example.com';
  const password = 'Client@12345';
  const passwordHash = await hashPassword(password);

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      passwordHash,
      role: 'CLIENT',
      clientId: client.id,
      name: 'Client User',
    },
    create: {
      name: 'Client User',
      email,
      passwordHash,
      role: 'CLIENT',
      clientId: client.id,
    },
  });

  return { email, password, user };
}

async function run() {
  console.log(`Running auth tests against ${BASE_URL}\n`);

  // 1. Missing credentials
  {
    const res = await request('/api/v1/auth/login', {
      method: 'POST',
      body: {},
    });
    assert(res.status === 400, 'Missing credentials returns 400');
    assert(res.json?.success === false, 'Missing credentials success=false');
  }

  // 2. Unknown email
  {
    const res = await request('/api/v1/auth/login', {
      method: 'POST',
      body: { email: 'missing@example.com', password: 'Whatever123!' },
    });
    assert(res.status === 401, 'Unknown email returns 401');
    assert(
      res.json?.message === 'Invalid email or password',
      'Unknown email uses generic auth error'
    );
  }

  // 3. Invalid password
  {
    const res = await request('/api/v1/auth/login', {
      method: 'POST',
      body: { email: adminEmail, password: 'WrongPassword!!!' },
    });
    assert(res.status === 401, 'Invalid password returns 401');
  }

  // 4. Valid admin login
  let accessToken;
  let refreshToken;

  {
    const res = await request('/api/v1/auth/login', {
      method: 'POST',
      body: { email: adminEmail, password: adminPassword },
    });

    assert(res.status === 200, 'Valid admin login returns 200');
    assert(res.json?.data?.user?.role === 'ADMIN', 'Login returns ADMIN role');
    assert(!!res.json?.data?.accessToken, 'Login returns access token');
    assert(!!res.json?.data?.refreshToken, 'Login returns refresh token');
    assert(
      !hasSensitiveLeak(res.json),
      'Login response does not leak sensitive fields'
    );

    accessToken = res.json?.data?.accessToken;
    refreshToken = res.json?.data?.refreshToken;
  }

  // 5. Authenticated profile
  {
    const res = await request('/api/v1/auth/me', { token: accessToken });
    assert(res.status === 200, 'Authenticated /me returns 200');
    assert(res.json?.data?.email === adminEmail.toLowerCase(), '/me email matches');
    assert(res.json?.data?.role === 'ADMIN', '/me role is ADMIN');
    assert(!hasSensitiveLeak(res.json), '/me does not leak password fields');
  }

  // 6. Invalid access token
  {
    const res = await request('/api/v1/auth/me', {
      token: 'invalid.access.token',
    });
    assert(res.status === 401, 'Invalid access token returns 401');
  }

  // 7. Refresh token rotation
  let rotatedAccess;
  let rotatedRefresh;

  {
    const res = await request('/api/v1/auth/refresh', {
      method: 'POST',
      body: { refreshToken },
    });

    assert(res.status === 200, 'Refresh returns 200');
    assert(!!res.json?.data?.accessToken, 'Refresh returns new access token');
    assert(!!res.json?.data?.refreshToken, 'Refresh returns new refresh token');
    assert(
      res.json?.data?.refreshToken !== refreshToken,
      'Refresh rotates refresh token'
    );

    rotatedAccess = res.json?.data?.accessToken;
    rotatedRefresh = res.json?.data?.refreshToken;
  }

  // Old refresh token should now be revoked
  {
    const res = await request('/api/v1/auth/refresh', {
      method: 'POST',
      body: { refreshToken },
    });
    assert(res.status === 401, 'Reused refresh token is rejected');
  }

  // 8. Logout and revoked refresh token
  {
    const logoutRes = await request('/api/v1/auth/logout', {
      method: 'POST',
      body: { refreshToken: rotatedRefresh },
    });
    assert(logoutRes.status === 200, 'Logout returns 200');

    const refreshRes = await request('/api/v1/auth/refresh', {
      method: 'POST',
      body: { refreshToken: rotatedRefresh },
    });
    assert(refreshRes.status === 401, 'Revoked refresh token is rejected');
  }

  // 9. Role authorization
  const clientCreds = await ensureClientUser();

  {
    const clientLogin = await request('/api/v1/auth/login', {
      method: 'POST',
      body: {
        email: clientCreds.email,
        password: clientCreds.password,
      },
    });

    assert(clientLogin.status === 200, 'Client login returns 200');

    const clientToken = clientLogin.json?.data?.accessToken;

    const forbidden = await request('/api/v1/auth/admin-check', {
      token: clientToken,
    });
    assert(forbidden.status === 403, 'CLIENT role denied on admin-check');

    // Re-login admin for fresh token after earlier logout path
    const adminLogin = await request('/api/v1/auth/login', {
      method: 'POST',
      body: { email: adminEmail, password: adminPassword },
    });
    const adminToken = adminLogin.json?.data?.accessToken;

    const allowed = await request('/api/v1/auth/admin-check', {
      token: adminToken,
    });
    assert(allowed.status === 200, 'ADMIN role allowed on admin-check');

    // rotatedAccess should still work until expiry (not revoked by logout of refresh)
    const stillValid = await request('/api/v1/auth/me', {
      token: rotatedAccess,
    });
    assert(
      stillValid.status === 200,
      'Existing access token remains valid until expiry'
    );
  }

  console.log(`\nResult: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

run()
  .catch((error) => {
    console.error('Auth test runner failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
