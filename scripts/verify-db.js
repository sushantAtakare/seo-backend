import prisma, { checkDatabaseConnection } from '../src/config/prisma.js';

const connection = await checkDatabaseConnection();
console.log('connection:', connection);

if (!connection.ok) {
  process.exit(1);
}

const tables = await prisma.$queryRaw`
  SELECT table_name
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_type = 'BASE TABLE'
  ORDER BY table_name
`;

console.log(
  'tables:',
  tables.map((row) => row.table_name).join(', ')
);

await prisma.$disconnect();
