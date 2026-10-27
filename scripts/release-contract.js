import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile,lstat,realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Evidence completeness is separate from the truth of a qualification result.
// Reviewers must inspect these retained reports; a JSON receipt is not a test,
// a publisher signature, or certification by a third party.
export const releaseRequirements=Object.freeze([
 ['correctness','Core maintainers','Required source, native, browser and installed-desktop suites; ownership and permission matrices.'],
 ['scientific-integrity','Research maintainers','Retained revisions, units, numerical domains, provenance and export consent.'],
 ['foreground-capacity','Performance maintainers','Repeated startup, authoring and preview p95/p99; declared budgets and measured competing load.'],
 ['aggregate-resources','Runtime maintainers','Process-tree RSS/CPU, owner growth, idle work, sustained load and cancellation recovery.'],
 ['dependency-review','Security maintainers','Fresh application/build/native-binary advisory review; no unresolved applicable high or critical advisories.'],
 ['authorization','Security maintainers','Negative route/owner tests, authority expiry and private-sentinel export checks.'],
 ['parser-boundary','Security maintainers','Pinned malformed inputs, finite parser budgets and verified filesystem/network restrictions of the declared profile.'],
 ['storage-recovery','Storage maintainers','Interrupted import/move/rekey/publication, disk full, denied access and process death; old/new-state recovery.'],
 ['backup-restoration','Storage maintainers','Restore independently retained backups; verify declared recovery point and recovery time.'],
 ['artifact-integrity','Release maintainers','Verify publisher identity, payload inventory, executable hashes, fuses and tamper handling on the distributed artifact.'],
 ['installation','Desktop maintainers','Clean-machine install, offline launch, credentials, PDF, close, supported-prior-version upgrade, rollback and uninstall preservation.'],
 ['provenance-licenses','Release maintainers','Shipping/build SBOMs, licenses, native tool origins and reproducible build provenance.'],
 ['usability','Interface maintainers','Keyboard and assistive technology, progress/cancel/uncertain outcomes, private diagnostics and update instructions.'],
 ['network-storage','Storage maintainers','Named protocol and mount profile, latency, disconnect/reconnect and server durability.','network'],
 ['live-hosting','Collaboration maintainers','Legitimate-peer latency under hostile traffic, bounded replay/queues and long-session authority expiry.','live']
].map(([id,owner,procedure,profile='all'])=>Object.freeze({id,owner,procedure,profile})));

const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const text=value=>typeof value==='string'&&value.trim().length>0&&value.length<=4096&&!/[\x00-\x08\x0b\x0c\x0e-\x1f]/u.test(value);
const finite=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const reject=message=>{throw Error('Release qualification: '+message);};
function performanceEvidence(r){
 const expected=['startup','record-save','record-reopen','website-preview'];
 if(!Array.isArray(r.measurements)||r.measurements.length!==expected.length)reject('foreground measurements are incomplete.');
 const names=new Set();
 for(const m of r.measurements){
  if(!object(m)||!expected.includes(m.name)||names.has(m.name))reject('foreground measurement is invalid or duplicated.');names.add(m.name);
  if(!Array.isArray(m.elapsedMs)||m.elapsedMs.length<20||m.elapsedMs.length>10000||m.elapsedMs.some(v=>!finite(v))||!finite(m.p95BudgetMs)||!finite(m.p99BudgetMs)||m.p95BudgetMs<=0||m.p99BudgetMs<m.p95BudgetMs)reject('foreground samples or declared budgets are invalid.');
  const values=[...m.elapsedMs].sort((a,b)=>a-b),percentile=fraction=>values[Math.ceil(values.length*fraction)-1];
  if(percentile(.95)>m.p95BudgetMs||percentile(.99)>m.p99BudgetMs)reject('foreground latency exceeds its declared profile.');
 }
}
export function validateReleaseEvidence(value,{now=Date.now()}={}){
 if(!object(value)||value.format!==1||!object(value.candidate)||!object(value.profile)||!Array.isArray(value.results))reject('invalid evidence document.');
 const c=value.candidate,p=value.profile;
 if(!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(c.version??'')||!/^[a-f0-9]{40}$/.test(c.commit??'')||!['win32','linux'].includes(c.platform)||c.arch!=='x64'||!hash(c.sha256)||!hash(c.payloadSha256))reject('candidate identity is incomplete.');
 if(!['local','network'].includes(p.storage)||typeof p.liveHosting!=='boolean'||!text(p.platform)||!text(p.hardware)||!text(p.storageConfiguration)||!text(p.concurrency)||!text(p.limitations))reject('supported profile is incomplete.');
 if(p.limits?.powerLossQualified!==false)reject('the current persistence implementation cannot claim power-loss qualification.');
 const required=releaseRequirements.filter(r=>r.profile==='all'||r.profile==='network'&&p.storage==='network'||r.profile==='live'&&p.liveHosting),seen=new Set();
 for(const r of value.results){
  if(!object(r)||!required.some(item=>item.id===r.requirement)||seen.has(r.requirement))reject('unexpected or duplicate requirement.');seen.add(r.requirement);
  if(r.result!=='pass')reject('every included requirement must pass; restrict the supported profile rather than hiding a failed gate.');
  if(r.candidateSha256!==c.sha256||r.payloadSha256!==c.payloadSha256||r.commit!==c.commit)reject('evidence belongs to a different candidate.');
  if(!text(r.owner)||!text(r.procedure)||!text(r.fixture)||!text(r.environment)||!finite(r.elapsedMs)||!text(r.limitations))reject('a result lacks reproducible qualification details.');
  const time=Date.parse(r.completedAt);if(!Number.isFinite(time)||time>now+300000||now-time>7*86400000)reject('qualification is stale or dated in the future.');
  if(!Array.isArray(r.reports)||!r.reports.length||r.reports.length>128||r.reports.some(file=>!object(file)||!hash(file.sha256)||!safeRelativeFile(file.file)))reject('retained reports are missing or unsafe.');
  if(r.requirement==='foreground-capacity')performanceEvidence(r);
 }
 if(required.some(r=>!seen.has(r.id)))reject('required qualification is missing: '+required.filter(r=>!seen.has(r.id)).map(r=>r.id).join(', ')+'.');
 return {candidate:c,profile:p,requirements:required.map(r=>r.id)};
}
function safeRelativeFile(value){return typeof value==='string'&&value.length<=512&&!/[:\\\x00-\x1f]/u.test(value)&&!value.startsWith('/')&&value.split('/').every(part=>part&&part!=='.'&&part!=='..');}
async function digest(file){const value=createHash('sha256');for await(const bytes of createReadStream(file))value.update(bytes);return value.digest('hex');}
async function regular(file){const stat=await lstat(file);if(!stat.isFile()||stat.isSymbolicLink())reject('artifact or report is not a regular file.');return stat;}
export async function qualifyRelease({artifact,evidence,payload,now}){
 if((await regular(evidence)).size>1024*1024)reject('evidence document exceeds its limit.');
 const value=JSON.parse(await readFile(evidence,'utf8')),result=validateReleaseEvidence(value,{now}),base=await realpath(path.dirname(evidence));
 await regular(artifact);await regular(payload);
 if(await digest(artifact)!==value.candidate.sha256||await digest(payload)!==value.candidate.payloadSha256)reject('candidate or payload digest does not match its qualification.');
 const checked=new Map();
 for(const r of value.results)for(const report of r.reports){
  const file=path.join(base,...report.file.split('/'));await regular(file);const actual=await realpath(file),relative=path.relative(base,actual);
  if(!relative||relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))reject('report escapes its evidence directory.');
  if(!checked.has(actual))checked.set(actual,await digest(actual));if(checked.get(actual)!==report.sha256)reject('retained report digest differs from its qualification.');
 }
 return {...result,reports:checked.size};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [artifact,evidence,payload,...extra]=process.argv.slice(2);
 if(!artifact||!evidence||!payload||extra.length)throw Error('Usage: node scripts/release-contract.js <installer> <evidence.json> <payload.json>');
 const result=await qualifyRelease({artifact,evidence,payload});console.log(JSON.stringify({qualified:true,...result}));
}
