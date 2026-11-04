import 'dotenv/config';
import prisma from '../src/config/prisma.js';
import { hashPassword } from '../src/utils/password.js';

const required = ['ADMIN_NAME', 'ADMIN_EMAIL', 'ADMIN_PASSWORD'];
const missing = required.filter((key) => !process.env[key]);

if (missing.length > 0) {
  console.error(
    `Missing required environment variables: ${missing.join(', ')}`
  );
  process.exit(1);
}

const name = process.env.ADMIN_NAME.trim();
const email = process.env.ADMIN_EMAIL.trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD;

if (password.length < 8) {
  console.error('ADMIN_PASSWORD must be at least 8 characters');
  process.exit(1);
}

async function seedAdmin() {
  const existing = await prisma.user.findUnique({
    where: { email },
  });

  if (existing) {
    console.info(`[seed-admin] Admin already exists: ${email}`);
    return;
  }

  const passwordHash = await hashPassword(password);

  const admin = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash,
      role: 'ADMIN',
      clientId: null,
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      createdAt: true,
    },
  });

  console.info('[seed-admin] Admin user created successfully');
  console.info(
    JSON.stringify(
      {
        id: admin.id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
      },
      null,
      2
    )
  );
}

seedAdmin()
  .catch((error) => {
    console.error('[seed-admin] Failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
