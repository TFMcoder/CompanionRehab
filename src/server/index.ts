import { configFromEnv, loadEnvironment } from './config.js';
import { createApp } from './app.js';
loadEnvironment();
const config = configFromEnv();
const app = await createApp(config);
await app.listen({ host: '127.0.0.1', port: config.port });
console.log(`Nancy is running at ${config.origin}. Cloud readiness: /api/config`);
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close().then(() => process.exit(0)); });
