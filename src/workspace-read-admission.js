import {reviewRequest} from './review-requests.js';
import {researchRequest} from './research-requests.js';
import {recordStarterRequest} from './record-starter-requests.js';
// Only routes owned by snapshot readers may continue during a storage copy or
// database preparation. Admission closes and drains before replacing their
// catalogue, clearing its key, or retiring its folder.
const get=new Set(['/api/dashboard','/api/notebook','/api/modules/data','/api/modules/version','/api/modules/history','/api/laboratory','/api/history','/api/media-policy','/api/fonts','/api/publishing']);
const post=new Set([
 '/api/publishing/plan-page','/api/publication-selections/read','/api/publication-selections/window',
 ...['list','archive','openArchived','open','sections','outline','section','history','capabilities','export','layouts','source','source-images','selection','preflight','fonts','font-read','image-read','exports','export-status','export-download'].map(name=>'/api/pdf/'+name),
 ...['open','window','item'].map(name=>'/api/websites/editor/'+name),
 ...['version','start','page','changes','change-page','selection','labels','dashboard','dashboard-types','record-types','discovery','timeline','record-content','record-selectors'].map(name=>'/api/workspace/read/'+name),
 ...['items','item','labels','bom-source','inventory/dashboard','inventory/discovery','inventory/stock','inventory/ledger','planning/dashboard','planning/discovery','planning/readiness'].map(name=>'/api/modules/'+name),
 ...['query','open','history/list','history/read','runs','runs/comparison','writing/read','values/read','values/figures','values/figure-copy-choices','values/figure-copy-source','values/attempt-context','runs/prepare'].map(name=>'/api/research/records/'+name),
 ...['source-owners','source-items','source-resolve','overview','dependency-review','list','references','figure-sources','current','schema','current-record','record','read','rows','retained-table','comparison-page','analysis-status'].map(name=>'/api/research/materials/'+name),
 ...['summary','content','record','sections','media'].map(name=>'/api/website/research/'+name),
 ...['owners','query','labels','resolve','incoming'].map(name=>'/api/modules/references/'+name),
 '/api/calendars/page','/api/calendars/event','/api/sharing/configuration','/api/sharing/figure',
 '/api/github-connection/status','/api/deployment-jobs/list','/api/deployment-jobs/status',
 '/api/repository-setup/current','/api/repository-setup/status','/api/publishing/verification',
 '/api/design-preview','/api/appearance-preview','/api/websites/list','/api/websites/open','/api/websites/version','/api/modules/drafts/read',
 '/api/laboratory/read/query','/api/laboratory/read/selected','/api/research/drafts/list','/api/modules/drafts/list'
]);
export const workspaceSnapshotRequest=(method,route)=>{
 if(method==='GET')return Boolean(reviewRequest(route,method)&&!reviewRequest(route,method).write)||/^\/api\/live\/figures\/(?:[a-f0-9-]{36}\/){2}[a-f0-9-]{36}$/.test(route)||/^\/api\/sharing\/figures\/[a-f0-9-]{36}\/(?:base|incoming|current)\/[a-f0-9-]{36}\/[a-f0-9-]{36}$/.test(route)||get.has(route)||/^\/api\/fonts\/custom-[a-f0-9]{64}$/.test(route)||/^\/(?:appearance-preview|preview)\/[a-f0-9]{64}\/.+/.test(route)||/^\/api\/appearance-preview\/[a-f0-9]{64}\/pages$/.test(route);
 if(method!=='POST')return false;const command=recordStarterRequest(route)??researchRequest(route)??reviewRequest(route);return post.has(route)||route==='/api/research/views/list'||Boolean(command&&!command.write);
};
export class WorkspaceReadAdmission{
 constructor(){this.accepting=true;this.active=new Set();}
 enter(){
  if(!this.accepting)return null;
  let finish;const pending=new Promise(resolve=>finish=resolve);this.active.add(pending);
  return ()=>{this.active.delete(pending);finish();};
 }
 async close(){this.accepting=false;await Promise.all(this.active);}
 open(){this.accepting=true;}
}
