import {describe,expect,it} from 'vitest';
import {publicFileFindings} from '../scripts/check-public-boundary';
describe('public repository boundary',()=>{
 it.each(['.local/runtime/connection.json','.env.local','dist/client/index.html','private.key','recording.wav'])('rejects private/generated path %s',path=>{expect(publicFileFindings(path,'')).toEqual([expect.objectContaining({rule:'private-or-generated-file'})]);});
 it('accepts the empty configuration template and synthetic summaries',()=>{expect(publicFileFindings('.env.example','DATABASE_URL=\nSESSION_KEY=')).toEqual([]);expect(publicFileFindings('docs/evidence/check.json',JSON.stringify({microphone_activated:false,private_reference:'.local/probes/result.json',transcript_logged:false}))).toEqual([]);});
 it('locates a synthetic secret without including its value in the finding',()=>{const value=['sk','proj', 'a'.repeat(40)].join('-');const findings=publicFileFindings('src/fixture.ts','line one\n'+value);expect(findings).toEqual([{path:'src/fixture.ts',rule:'openai-key',line:2}]);expect(JSON.stringify(findings)).not.toContain(value);});
 it('rejects raw private evidence nested inside a report',()=>{expect(publicFileFindings('docs/evidence/check.json',JSON.stringify({result:{transcript:'Synthetic test payload'}}))).toEqual([{path:'docs/evidence/check.json',rule:'private-evidence-payload'}]);});
});
