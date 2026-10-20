import { mkdir, open, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { Pool } from 'pg';
import { loadEnvironment, configFromEnv } from '../src/server/config.js';
import { applyClientProvision, clientProvisionRequestSchema, ClientProvisionError, createClientCredential,
  decryptClientCredential, encryptClientCredential, reviewClientProvision } from '../src/server/client-provisioning.js';

// Deliberately local and operator-only. No provider connection, migration, seed or reset.
function inside(base: string, supplied: string): string {
  const value = resolve(supplied), path = relative(base, value);
  if (!path || path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path))
    throw new ClientProvisionError('private_path_required', 'Use a file within the required ignored private directory.');
  return value;
}
async function main() {
  const [mode, requestName, reviewedDigest, ...extra] = process.argv.slice(2);
  if (!['review', 'apply'].includes(mode) || !requestName || extra.length || mode === 'review' && reviewedDigest
    || mode === 'apply' && !/^[a-f0-9]{64}$/.test(reviewedDigest || ''))
    throw new ClientProvisionError('usage', 'Usage: tsx scripts/provision-client-account.ts review .local/provisioning/request.json | apply .local/provisioning/request.json REVIEW_DIGEST');
  const directory = resolve('.local/provisioning');
  const request = clientProvisionRequestSchema.parse(JSON.parse(await readFile(inside(directory, requestName), 'utf8')));
  loadEnvironment();
  const config = configFromEnv();
  if (!config.databaseUrl) throw new ClientProvisionError('database_missing', 'The existing local database configuration is required.');
  const database = new URL(config.databaseUrl);
  if (!['localhost', '127.0.0.1'].includes(database.hostname) || database.port !== '55432' || database.pathname !== '/nancy_client_trial')
    throw new ClientProvisionError('wrong_database', 'This operator tool only accepts the existing local client-trial database.');
  const pool = new Pool({ connectionString: config.databaseUrl, max: 1, connectionTimeoutMillis: 5000, query_timeout: 15000 });
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if (mode === 'review') {
      const review = await reviewClientProvision(pool, request);
      await writeFile(resolve(directory, request.operation_id + '.review.json'), JSON.stringify(review, null, 2), { mode: 0o600 });
      console.log('Read-only review saved in .local/provisioning. Verify the explicit actor/profile IDs, grant transition, preservation counts and approval/backup references there. No account or care records changed.');
      return;
    }
    if (!config.sessionKey || config.sessionKey.length !== 32)
      throw new ClientProvisionError('key_missing', 'The existing private session key is required to protect the generated login.');
    const backup = await open(inside(resolve('.local/backups'), request.backup_ref), 'r');
    try {
      const header = Buffer.alloc(7); await backup.read(header, 0, 7, 0);
      if (header.toString() !== 'NANCY01' || (await backup.stat()).size < 36)
        throw new ClientProvisionError('backup_missing', 'Provide the reviewed encrypted backup reference before applying account access changes.');
    } finally { await backup.close(); }
    const credentialPath = resolve(directory, request.operation_id + '.login.enc');
    let credential;
    try { credential = decryptClientCredential(await readFile(credentialPath), config.sessionKey, request); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      credential = createClientCredential(request);
      // Persist before a possible commit. Retries must reuse this exact protected login.
      await writeFile(credentialPath, encryptClientCredential(credential, config.sessionKey), { mode: 0o600, flag: 'wx' });
    }
    const result = await applyClientProvision(pool, request, reviewedDigest!, credential.password);
    await writeFile(resolve(directory, request.operation_id + '.result.json'), JSON.stringify(result, null, 2), { mode: 0o600 });
    console.log(result.replayed
      ? 'Existing provisioning result recovered. The protected login was reused; no credentials were rotated.'
      : 'Client account provisioned and prior practice client access retired. Private result and encrypted login are in .local/provisioning. Care history is preserved; inference eligibility is unchanged.');
  } finally { await pool.end(); }
}
main().catch(error => {
  // Driver/Zod diagnostics may contain private input. Print only our bounded operator messages.
  console.error(error instanceof ClientProvisionError ? `${error.code}: ${error.message}`
    : 'Provisioning could not be confirmed. Check the private request/configuration. Preserve all private artifacts and retry the same operation after reviewing its state.');
  process.exitCode = 1;
});
