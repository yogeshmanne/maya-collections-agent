// Loads .env.test, runs migrations against the real test database, and
// truncates all tables before each test file so tests are isolated but
// still run against a real Postgres instance — no in-memory DB mocking.
require('dotenv').config({ path: '.env.test' });

const { execSync } = require('child_process');
const pool = require('../src/db/pool');
const cuid = require('cuid');
const { hashCode } = require('../src/utils/mask');

beforeAll(() => {
  execSync('node src/db/migrate.js', { env: { ...process.env }, stdio: 'inherit' });
});

beforeEach(async () => {
  await pool.query('TRUNCATE tool_call_logs, promises_to_pay, escalations, calls, accounts CASCADE');

  await pool.query(
    `INSERT INTO accounts (id, account_ref, customer_name, loan_type, amount_due, days_past_due, verification_hash)
     VALUES ($1, 'ACC-88392', 'Rahul Sharma', 'Personal Loan', 8499, 12, $2)`,
    [cuid(), hashCode('1234')]
  );
});

afterAll(async () => {
  await pool.end();
});
