import { configFromEnv, loadEnvironment } from '../src/server/config.js';
import { PlanStore, defaultPlanPath } from '../src/server/chatgpt-plan/storage.js';
import { startPlanSetup } from '../src/server/chatgpt-plan/local.js';

loadEnvironment();
const key = configFromEnv().sessionKey;
if (!key) throw new Error('SESSION_KEY is required for protected ChatGPT connection storage.');
const setup = await startPlanSetup(new PlanStore(defaultPlanPath, key));
console.log(`Open this local setup page: ${setup.url}`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void setup.close().then(() => process.exit(0)); });
