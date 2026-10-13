// Windows demo supervisor. Private settings stay in .local; this never creates
// users, seeds data, changes inference credentials, or publishes a tunnel.
import { readFileSync, writeFileSync, openSync, closeSync, unlinkSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const runtime = path.join(root, '.local/runtime');
mkdirSync(runtime, { recursive: true });
const settings = JSON.parse(readFileSync(path.join(runtime, 'demo-host.json'), 'utf8'));
const origin = new URL(settings.origin);
if (origin.origin !== settings.origin || origin.username || origin.password ||
    (origin.protocol !== 'https:' && settings.origin !== 'http://localhost:8787')) throw Error('Invalid demo origin');
const lock = path.join(runtime, 'demo-supervisor.lock');
async function inspectProcess(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw Error('Invalid process identity');
  const { stdout } = await run('powershell.exe', ['-NoProfile', '-Command',
    `Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}' | Select-Object ExecutablePath,CommandLine | ConvertTo-Json -Compress`],
  { windowsHide: true, timeout: 10000 });
  return stdout.trim() ? JSON.parse(stdout) : null;
}
function isNode(info) { return info?.ExecutablePath?.toLowerCase() === process.execPath.toLowerCase(); }
try {
  const previous = Number(readFileSync(lock, 'utf8'));
  if (!Number.isSafeInteger(previous) || previous <= 0) throw Error('Invalid supervisor lock; inspect it privately.');
  const info = await inspectProcess(previous);
  if (isNode(info) && info.CommandLine?.toLowerCase().includes(fileURLToPath(import.meta.url).toLowerCase())) process.exit(0);
  // A reused PID belonging to a different program cannot strand the startup task.
  unlinkSync(lock);
} catch (error) { if (error.code !== 'ENOENT') throw error; }
const lockFd = openSync(lock, 'wx');
writeFileSync(lockFd, String(process.pid)); closeSync(lockFd);
const pgBin = path.join(root, '.local/postgres/pgsql/bin');
const pgData = path.join(root, '.local/postgres/data');
let child, stopping = false, restarts = 0, failures = 0, started = 0, runId;
const stateFile = path.join(runtime, 'demo-supervisor.json');
const previousState = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : null;
function record(state, reason) {
  const next = stateFile + '.tmp';
  writeFileSync(next, JSON.stringify({ updated_at: new Date().toISOString(), state, reason,
    supervisor_pid: process.pid, app_pid: child?.pid ?? null, app_run_id: runId ?? null,
    restarts, origin: origin.origin }) + '\n');
  renameSync(next, stateFile);
}
function health() {
  return new Promise(resolve => {
    const req = http.get({ hostname: '127.0.0.1', port: 8787, path: '/api/config',
      headers: { host: origin.host }, timeout: 3000 }, res => {
      res.resume(); resolve(res.statusCode === 200);
    });
    req.on('timeout', () => req.destroy()); req.on('error', () => resolve(false));
  });
}
function portInUse() {
  return new Promise(resolve => {
    const socket = net.createConnection({ host: '127.0.0.1', port: 8787 });
    socket.setTimeout(3000);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
    socket.once('timeout', () => { socket.destroy(); resolve(true); });
  });
}
async function database() {
  try { await run(path.join(pgBin, 'pg_ctl.exe'), ['status', '-D', pgData], { windowsHide: true }); }
  catch {
    await run(path.join(pgBin, 'pg_ctl.exe'), ['start', '-D', pgData, '-w', '-t', '30',
      '-l', path.join(runtime, 'demo-postgres.log'), '-o', '-h 127.0.0.1 -p 55432'],
    { windowsHide: true, timeout: 35000 });
  }
}
function rotate(file) {
  // Bound process logs to five launches. Never include transcript/credential data.
  for (let i = 4; i >= 0; i--) {
    const old = i === 0 ? file : `${file}.${i}`;
    if (!existsSync(old)) continue;
    if (i === 4) unlinkSync(old); else renameSync(old, `${file}.${i + 1}`);
  }
}
function start() {
  const out = path.join(runtime, 'demo-app.stdout.log'), err = path.join(runtime, 'demo-app.stderr.log');
  rotate(out); rotate(err);
  const outFd = openSync(out, 'a'), errFd = openSync(err, 'a');
  // Tailscale does not use Cloudflare's client-IP header. Keep that trust mode off.
  runId = randomUUID();
  child = spawn(process.execPath, ['--import', 'tsx', 'src/server/index.ts', `--nancy-demo-run=${runId}`], {
    cwd: root, windowsHide: true, stdio: ['ignore', outFd, errFd],
    env: { ...process.env, PUBLIC_ORIGIN: origin.origin, PORT: '8787', NANCY_TRUSTED_PROXY: '' },
  });
  closeSync(outFd); closeSync(errFd);
  const launched = child;
  child.on('error', () => { launched.demoExited = true; });
  child.on('exit', () => { launched.demoExited = true; });
  started = Date.now(); failures = 0; record('starting');
}
async function stopChild() {
  if (child?.pid && !child.demoExited && child.exitCode === null && child.signalCode === null) {
    const info = await inspectProcess(child.pid);
    if (isNode(info) && info.CommandLine?.includes(`--nancy-demo-run=${runId}`)) {
      await run('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }).catch(() => {});
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  child = undefined;
}
async function recoverOrphan() {
  const pid = previousState?.app_pid, id = previousState?.app_run_id;
  if (!Number.isSafeInteger(pid) || pid <= 0 || !/^[a-f0-9-]{36}$/.test(id ?? '')) return;
  const processInfo = await inspectProcess(pid);
  // A PID alone is not identity. Require the exact executable and unique launch
  // marker recorded by this supervisor before stopping an orphan process tree.
  if (isNode(processInfo) &&
      processInfo.CommandLine?.includes(`--nancy-demo-run=${id}`)) {
    await run('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}
async function finish() {
  if (stopping) return; stopping = true;
  await stopChild(); record('stopped');
  try { unlinkSync(lock); } catch {}
  process.exit(0);
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => void finish());
try {
  await recoverOrphan();
  // Refuse to adopt or kill a process we did not create. The operator must stop
  // the previous app explicitly before enabling supervision.
  if (await portInUse()) throw Error('The app is already running outside this supervisor.');
  while (!stopping) {
    try {
      await database();
      if (!child || child.demoExited || child.exitCode !== null || child.signalCode !== null) { if (child) restarts++; start(); }
      if (await health()) { failures = 0; record('ready'); }
      else if (Date.now() - started > 60000 && ++failures >= 3) {
        record('recovering', 'http_unresponsive'); await stopChild(); restarts++;
      }
    } catch {
      record('recovering', 'local_dependency_unavailable');
      // Retry without logging database connection strings or provider errors.
    }
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
} catch (error) {
  record('blocked', error.message === 'The app is already running outside this supervisor.' ? 'existing_app' : 'startup_failed');
  try { unlinkSync(lock); } catch {}
  process.exitCode = 1;
}
