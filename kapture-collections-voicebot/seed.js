// Note: kept under prisma/ for familiarity even though we're not using
// Prisma's client — this just seeds the plain-`pg` schema in src/db/migrations.
require('dotenv').config();
const cuid = require('cuid');
const { Pool } = require('pg');
const { hashCode } = require('../src/utils/mask');

async function seed() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const accounts = [
    {
      accountRef: 'ACC-88392',
      customerName: 'Rahul Sharma',
      loanType: 'Personal Loan',
      amountDue: 8499,
      daysPastDue: 12,
      verificationCode: '1234', // last-4 PAN or birth year, either accepted for demo
    },
    {
      accountRef: 'ACC-77281',
      customerName: 'Priya Nair',
      loanType: 'Personal Loan',
      amountDue: 15200,
      daysPastDue: 5,
      verificationCode: '1998',
    },
  ];

  for (const acc of accounts) {
    const existing = await pool.query('SELECT id FROM accounts WHERE account_ref = $1', [acc.accountRef]);
    if (existing.rows.length > 0) {
      console.log(`[seed] ${acc.accountRef} already exists, skipping`);
      continue;
    }
    await pool.query(
      `INSERT INTO accounts (id, account_ref, customer_name, loan_type, amount_due, days_past_due, verification_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        cuid(),
        acc.accountRef,
        acc.customerName,
        acc.loanType,
        acc.amountDue,
        acc.daysPastDue,
        hashCode(acc.verificationCode),
      ]
    );
    console.log(`[seed] created ${acc.accountRef} (${acc.customerName})`);
  }

  await pool.end();
  console.log('[seed] done.');
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
