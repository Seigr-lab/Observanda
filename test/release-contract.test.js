import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,mkdir,symlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {releaseRequirements,validateReleaseEvidence,qualifyRelease} from '../scripts/release-contract.js';
const digest=value=>createHash('sha256').update(value).digest('hex'),now=Date.parse('2026-10-27T12:00:00Z');
function evidence({storage='local',liveHosting=false}={}){
 const candidate={version:'0.3.0',commit:'a'.repeat(40),platform:'win32',arch:'x64',sha256:digest('installer'),payloadSha256:digest('payload')};
 const profile={storage,liveHosting,platform:'Synthetic target',hardware:'Synthetic workstation',storageConfiguration:'Synthetic local filesystem',concurrency:'Measured competing load in retained report',limitations:'Synthetic validator fixture only',limits:{powerLossQualified:false}};
 return {format:1,candidate,profile,results:releaseRequirements.filter(r=>r.profile==='all'||r.profile==='network'&&storage==='network'||r.profile==='live'&&liveHosting).map(r=>({requirement:r.id,result:'pass',candidateSha256:candidate.sha256,payloadSha256:candidate.payloadSha256,commit:candidate.commit,owner:r.owner,procedure:r.procedure,fixture:'synthetic-verifier-v1',environment:'Synthetic validation fixture, not actual qualification',elapsedMs:10,completedAt:new Date(now).toISOString(),limitations:'Not actual release evidence',reports:[{file:'reports/result.txt',sha256:digest('synthetic report')}],...(r.id==='foreground-capacity'?{measurements:['startup','record-save','record-reopen','website-preview'].map(name=>({name,elapsedMs:Array(20).fill(10),p95BudgetMs:20,p99BudgetMs:30}))}:{})}))};
}
test('all declared profile requirements are mandatory and bound to the exact candidate',()=>{
 for(const profile of [{},{storage:'network'},{liveHosting:true},{storage:'network',liveHosting:true}]){
  const value=evidence(profile);assert.equal(validateReleaseEvidence(value,{now}).requirements.length,value.results.length);
  for(const result of value.results){const removed=structuredClone(value);removed.results=removed.results.filter(r=>r.requirement!==result.requirement);assert.throws(()=>validateReleaseEvidence(removed,{now}),/missing/);}
 }
 for(const field of ['candidateSha256','payloadSha256','commit']){const value=evidence();value.results[0][field]='b'.repeat(field==='commit'?40:64);assert.throws(()=>validateReleaseEvidence(value,{now}),/different candidate/);}
});
test('failure, duplicate, expired, incomplete and invented power-loss qualification cannot be accepted',()=>{
 for(const result of ['fail','skip','exception']){const value=evidence();value.results[0].result=result;assert.throws(()=>validateReleaseEvidence(value,{now}),/must pass/);}
 const duplicate=evidence();duplicate.results.push(duplicate.results[0]);assert.throws(()=>validateReleaseEvidence(duplicate,{now}),/duplicate/);
 const expired=evidence();assert.throws(()=>validateReleaseEvidence(expired,{now:now+8*86400000}),/stale/);
 const future=evidence();assert.throws(()=>validateReleaseEvidence(future,{now:now-3600000}),/future/);
 const incomplete=evidence();delete incomplete.results[0].fixture;assert.throws(()=>validateReleaseEvidence(incomplete,{now}),/details/);
 const power=evidence();power.profile.limits.powerLossQualified=true;assert.throws(()=>validateReleaseEvidence(power,{now}),/power-loss/);
});
test('measured foreground percentiles must fit explicitly declared budgets',()=>{
 const value=evidence(),r=value.results.find(r=>r.requirement==='foreground-capacity');r.measurements[0].elapsedMs[0]=31;assert.throws(()=>validateReleaseEvidence(value,{now}),/latency/);
 r.measurements[0].elapsedMs[0]=30;assert.doesNotThrow(()=>validateReleaseEvidence(value,{now}));r.measurements[0].elapsedMs.pop();assert.throws(()=>validateReleaseEvidence(value,{now}),/samples/);
});
test('candidate, payload and retained report bytes are verified; unsafe and altered reports fail',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-release-contract-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(path.join(root,'reports'));
 const artifact=path.join(root,'candidate.exe'),payload=path.join(root,'payload.json'),file=path.join(root,'evidence.json'),report=path.join(root,'reports/result.txt');
 await writeFile(artifact,'installer');await writeFile(payload,'payload');await writeFile(report,'synthetic report');const value=evidence();await writeFile(file,JSON.stringify(value));const options={artifact,payload,evidence:file,now};assert.equal((await qualifyRelease(options)).reports,1);
 await writeFile(artifact,'changed installer');await assert.rejects(qualifyRelease(options),/candidate or payload/);await writeFile(artifact,'installer');
 await writeFile(payload,'changed payload');await assert.rejects(qualifyRelease(options),/candidate or payload/);await writeFile(payload,'payload');
 await writeFile(report,'changed report');await assert.rejects(qualifyRelease(options),/report digest/);await writeFile(report,'synthetic report');
 for(const name of ['../outside','/absolute','C:/private','reports/../outside','reports\\result.txt']){const bad=structuredClone(value);bad.results[0].reports[0].file=name;assert.throws(()=>validateReleaseEvidence(bad,{now}),/unsafe/);}
 const outside=await mkdtemp(path.join(os.tmpdir(),'observanda-release-outside-'));t.after(()=>rm(outside,{recursive:true,force:true}));await writeFile(path.join(outside,'result.txt'),'synthetic report');await symlink(outside,path.join(root,'escaped'),process.platform==='win32'?'junction':'dir');
 value.results[0].reports[0].file='escaped/result.txt';await writeFile(file,JSON.stringify(value));await assert.rejects(qualifyRelease(options),/escapes/);
});
