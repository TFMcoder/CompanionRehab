import { existsSync } from 'node:fs';
import { z } from 'zod';

export function loadEnvironment() {
  if (existsSync('.env.local')) process.loadEnvFile('.env.local');
}
export interface Config {
  origin: string; port: number; supabaseUrl?: string; supabaseKey?: string;
  sessionKey?: Buffer; openaiKey?: string; voiceModel: string;
  voiceMinutes: number; voiceDailyMinutes: number;
}
export function configFromEnv(env: NodeJS.ProcessEnv = process.env): Config {
  const origin = new URL(env.PUBLIC_ORIGIN || 'http://localhost:8787');
  if (origin.origin !== (env.PUBLIC_ORIGIN || 'http://localhost:8787') || origin.username || origin.password
    || (origin.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(origin.hostname)))
    throw new Error('PUBLIC_ORIGIN must be an HTTPS origin (HTTP allowed only on localhost).');
  let supabaseUrl: string | undefined;
  if (env.SUPABASE_URL) {
    const url = new URL(env.SUPABASE_URL);
    if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
      throw new Error('SUPABASE_URL must be a plain HTTPS project origin.');
    supabaseUrl = url.origin;
  }
  const key = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || undefined;
  if (key?.startsWith('sb_secret_')) throw new Error('Use the Supabase publishable key, never a secret key.');
  if (key?.split('.').length === 3) {
    try { if (JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role !== 'anon') throw new Error(); }
    catch { throw new Error('Legacy runtime keys must be the anon key, never service_role.'); }
  }
  const sessionKey = env.SESSION_KEY ? Buffer.from(env.SESSION_KEY, 'base64') : undefined;
  if (sessionKey && sessionKey.length !== 32) throw new Error('SESSION_KEY must encode 32 random bytes in base64.');
  return {
    origin: origin.origin, port: z.coerce.number().int().min(1024).max(65535).parse(env.PORT || 8787),
    supabaseUrl, supabaseKey: key, sessionKey, openaiKey: env.OPENAI_API_KEY || undefined,
    voiceModel: env.OPENAI_REALTIME_MODEL || 'gpt-realtime-mini',
    voiceMinutes: z.coerce.number().min(1).max(20).parse(env.VOICE_SESSION_MINUTES || 10),
    voiceDailyMinutes: z.coerce.number().min(1).max(60).parse(env.VOICE_DAILY_MINUTES || 20),
  };
}
export function missingConfig(c: Config) {
  return [!c.supabaseUrl && 'SUPABASE_URL', !c.supabaseKey && 'SUPABASE_PUBLISHABLE_KEY', !c.sessionKey && 'SESSION_KEY'].filter(Boolean) as string[];
}
