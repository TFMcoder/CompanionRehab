import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { RuntimeLog, safeEvent } from '../src/server/telemetry.js';
import { createApp } from '../src/server/app.js';
import { configFromEnv } from '../src/server/config.js';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('operational metadata', () => {
  it('keeps measurements and nutrition source hashes without bodies, tokens or arbitrary URLs', () => {
    const event = safeEvent({ kind:'conversation', outcome:'ok', actor_id:randomUUID(), turn_id:'secret-token', measurements:{
      duration_ms: 15.6, input_chars:500, transcript:'private care', access_token:'private token', route:'/api/conversation/:id/turn',
      url:'/api/speech?token=secret', bad:NaN, nutrition_refs:[{document_id:'CR_NUTRITION_EVIDENCE_V1',sha256:'a'.repeat(64),items:['C01','private words']}],
    } });
    expect(event.turn_id).toBeUndefined();
    expect(event.measurements).toMatchObject({duration_ms:16,input_chars:500,nutrition_refs:[{items:['C01']}]});
    expect(JSON.stringify(event)).not.toMatch(/private|token|secret|NaN/);
  });
  it('does not block a response, retries with stable IDs and drains on close', async () => {
    const warn=vi.fn(); const db={query:vi.fn().mockRejectedValueOnce(new Error('private driver values')).mockResolvedValue({rows:[]})};
    const log=new RuntimeLog(db,warn);
    log.record({kind:'http',outcome:'ok',measurements:{route:'/api/today',status_code:200}});
    expect(db.query).not.toHaveBeenCalled();
    await log.flush(); expect(log.status().pending).toBe(1); expect(warn).toHaveBeenCalledTimes(1);
    const first=JSON.parse(db.query.mock.calls[0][1][0]);
    await log.close(); const second=JSON.parse(db.query.mock.calls[1][1][0]);
    expect(second[0].id).toBe(first[0].id); expect(log.status().pending).toBe(0);
  });
  it('bounds its queue while the database is unavailable', async () => {
    const log=new RuntimeLog({query:vi.fn().mockRejectedValue(new Error('offline'))},vi.fn());
    for(let i=0;i<600;i++)log.record({kind:'http',outcome:'error'});
    expect(log.status()).toMatchObject({pending:512,dropped:88}); await log.close();
  });
  it('denies stale preview files and records API metadata without login credentials', async () => {
    const root=await mkdtemp(join(tmpdir(),'nancy-product-'));
    await mkdir(join(root,'assets')); await writeFile(join(root,'preview.html'),'synthetic audition');
    await writeFile(join(root,'assets','preview-old.js'),'synthetic audition');
    const config=configFromEnv({PUBLIC_ORIGIN:'http://localhost:8787'});
    const record=vi.fn();
    const app=await createApp(config,{staticRoot:root,runtimeLog:{record,close:vi.fn()} as any});
    try {
      for(const url of ['/preview','/preview.html','/assets/preview-old.js'])expect((await app.inject({url,headers:{host:'localhost:8787'}})).statusCode).toBe(404);
      await app.inject({method:'POST',url:'/api/auth/login',headers:{host:'localhost:8787',origin:config.origin},payload:{email:'private@example.invalid',password:'private-password'}});
      expect(record).toHaveBeenCalled(); expect(JSON.stringify(record.mock.calls)).not.toContain('private');
      expect(record.mock.calls[0][0]).toMatchObject({kind:'http',outcome:'error',measurements:{route:'/api/auth/login'}});
    } finally {await app.close();await rm(root,{recursive:true,force:true});}
  });
});
