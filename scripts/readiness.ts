import { configFromEnv, loadEnvironment, missingConfig } from '../src/server/config.js';
loadEnvironment();
const config = configFromEnv();
const missing = [...missingConfig(config), ...(!config.openaiKey ? ['OPENAI_API_KEY'] : [])];
console.log(JSON.stringify({ assistant: 'Nancy', origin: config.origin, missing, local_code_only: !process.argv.includes('--connect'), live_acceptance: 'not_run' }, null, 2));
if (process.argv.includes('--connect')) {
  if (missingConfig(config).length) { process.exitCode = 1; }
  else {
    try {
      const r = await fetch(`${config.supabaseUrl}/auth/v1/settings`, { headers: { apikey: config.supabaseKey! }, redirect: 'error', signal: AbortSignal.timeout(10000) });
      console.log(JSON.stringify({ supabase_auth_reachable: r.ok, status: r.status, note: 'Read-only reachability; this does not verify the migration, a user session, voice or live acceptance.' }));
      if (!r.ok) process.exitCode = 1;
    } catch { console.log('Supabase reachability failed; credentials were not printed.'); process.exitCode = 1; }
  }
}
