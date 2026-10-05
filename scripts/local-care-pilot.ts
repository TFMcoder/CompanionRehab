import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { bootstrapLocalUser, LocalCare } from '../src/server/local-care.js';
import { setupSchema } from '../src/shared/contracts.js';

// Creates only a labeled synthetic pilot. Never bootstrap a household profile implicitly.
process.loadEnvFile('.local/runtime/local-care.env');
const url = new URL(process.env.DATABASE_URL!);
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== '55432') throw new Error('Use the local Nancy PostgreSQL instance.');
url.pathname = '/nancy_myday';
const pool = new Pool({ connectionString: url.toString(), max: 2 });
const care = new LocalCare({ pool });
try {
  const email = 'owner-pilot@nancy.local';
  const exists = await pool.query('select id from companion_local.accounts where email=$1', [email]);
  if (exists.rowCount) throw new Error('The owner pilot already exists. Reuse the private login file.');
  const password = randomBytes(18).toString('base64url');
  const owner = await bootstrapLocalUser(pool, { email, password, role: 'client', display_name: 'Practice Day', time_zone: 'America/Toronto' });
  const session = await care.login(email, password);
  await care.setup(session, setupSchema.parse({ display_name: 'Practice Day', time_zone: 'America/Toronto', expected_revision: 0, preferences: 'Synthetic demonstration only. Ordinary meal ideas. No clinical dietary or rehabilitation instructions are supplied.',
    tasks: [
      { title: 'Plan the day', urgency: 'high', time_hint: 'Morning', scheduled_time: '10:00', category: 'task', duration_minutes: 15 },
      { title: 'Post-breakfast exercise (sample task)', urgency: 'medium', time_hint: 'After breakfast', scheduled_time: '10:20', category: 'exercise', duration_minutes: null },
      { title: 'Approved rehab routine (sample task)', urgency: 'medium', time_hint: 'Morning', scheduled_time: '10:40', category: 'rehab', duration_minutes: null },
    ],
    meal_options: [
      { name: 'Oatmeal with berries', slots: ['breakfast'] }, { name: 'Eggs and toast', slots: ['breakfast'] }, { name: 'Yogurt with fruit', slots: ['breakfast'] },
      { name: 'Vegetable soup and toast', slots: ['lunch'] }, { name: 'Chicken sandwich', slots: ['lunch'] }, { name: 'Bean salad', slots: ['lunch'] },
      { name: 'Chicken, rice and vegetables', slots: ['dinner'] }, { name: 'Lentil pasta', slots: ['dinner'] }, { name: 'Fish, potatoes and peas', slots: ['dinner'] },
    ] }));
  await care.logout(session);
  const env = await readFile('.local/runtime/local-care.env', 'utf8');
  const updated = env.replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=${url.toString()}`) + `NANCY_PLAN_USER_ID=${owner.user_id}\nNANCY_VOICE_TRANSPORT=local\nNANCY_SYNTHETIC=1\n`;
  await writeFile('.local/runtime/local-care.env', updated, { mode: 0o600 });
  await writeFile('.local/runtime/owner-pilot-login.json', JSON.stringify({ email, password, user_id: owner.user_id, purpose: 'Owner-operated synthetic My Day qualification; not participant entitlement or real care data.' }), { mode: 0o600, flag: 'wx' });
  await writeFile('.local/runtime/owner-pilot-login.txt', `Nancy — practice My Day\n\nEmail: ${email}\nPassword: ${password}\n\nThis sign-in uses sample data only. It is for your supervised owner test.\nDo not put real care data into this practice account.\n`, { mode: 0o600, flag: 'wx' });
  console.log('Synthetic owner pilot created. Private login saved under .local/runtime/owner-pilot-login.txt. No credentials printed.');
} finally { await pool.end(); }
