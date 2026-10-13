// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Progress } from '../src/client/Progress';

afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
const day=(status:'no_plan'|'unconfigured'|'ready')=>({local_date:'2026-10-13',status,time_zone:'America/Toronto',plan_id:null,
  plan_version:null,rule_version:null,protocol_versions:[],score_percent:null,completed_weight:null,known_weight:null,missing_count:null,
  deferred_count:null,exempt_count:null,corrected_count:null,sources:[],source_digest:null,snapshot_generation:null,stale:false,achievements:[]});
const workspace=(status:'no_plan'|'unconfigured'|'ready')=>({role:'client',time_zone:'America/Toronto',from:'2026-10-07',to:'2026-10-13',
  days:[day(status)],trend:{days_in_range:1,days_with_accepted_plan:status==='no_plan'?0:1,days_without_accepted_plan:status==='no_plan'?1:0,
    days_with_reported_outcome:0,days_with_missing_reports:0,average_reported_percent:null,corrected_days:0,plan_versions:[],rule_versions:[]},
  active_rules:null,archetypes:[],clinical_config:null,allowed_fields:[],can_approve_rules:false,can_export:false,access_grants:[]});
function response(data:unknown){return {ok:true,status:200,json:async()=>data};}
function deferred<T>() {let resolve!: (value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return {promise,resolve};}

describe('progress UI',()=>{
  it('shows missing setup honestly and keeps the five archetype names available',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response(workspace('unconfigured'))));
    render(<Progress scopeKey="client-a" localDate="2026-10-13" visible/>);
    expect(await screen.findByText('Progress rules have not been approved for this day.')).toBeTruthy();
    expect(screen.getByRole('option',{name:'Diabetes'})).toBeTruthy();
    expect(screen.getByRole('option',{name:'Neurorehab'})).toBeTruthy();
    expect(screen.getByRole('option',{name:'Psychologist / Psychiatrist'})).toBeTruthy();
    expect(screen.getByRole('option',{name:'Family doctor'})).toBeTruthy();
    expect(screen.getByRole('option',{name:'OT / PSW / DSW'})).toBeTruthy();
    expect(screen.queryByText(/clinical outcome claim/i)).toBeNull();
  });
  it('drops a late response when the authenticated scope changes',async()=>{
    const first=deferred<unknown>(),second=deferred<unknown>();
    const fetch=vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);vi.stubGlobal('fetch',fetch);
    const view=render(<Progress scopeKey="client-a" localDate="2026-10-13" visible/>);
    await vi.waitFor(()=>expect(fetch).toHaveBeenCalledTimes(1));
    view.rerender(<Progress scopeKey="client-b" localDate="2026-10-13" visible/>);
    await vi.waitFor(()=>expect(fetch).toHaveBeenCalledTimes(2));
    second.resolve(response(workspace('no_plan')));
    expect(await screen.findByText('No accepted plan for this day.')).toBeTruthy();
    first.resolve(response(workspace('unconfigured')));
    await Promise.resolve();await Promise.resolve();
    expect(screen.queryByText('Progress rules have not been approved for this day.')).toBeNull();
  });
});
