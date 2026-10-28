import {materialRequest} from './material-route-policy.js';
import {pdfDocumentRequest} from './pdf-route-policy.js';
import {projectPublicationRequest} from './project-publication-requests.js';
import {reviewRequest} from './review-route-policy.js';
import {researchRequest} from './research-requests.js';
import {recordStarterRequest} from './record-starter-requests.js';
// Only routes owned by snapshot readers may continue during a storage copy or
// database preparation. Admission closes and drains before replacing their
// catalogue, clearing its key, or retiring its folder.
const get=new Set(['/api/dashboard','/api/notebook','/api/modules/data','/api/modules/version','/api/modules/history','/api/laboratory','/api/history','/api/media-policy','/api/fonts']);
const post=new Set([
 ...['version','start','page','changes','change-page','selection','labels','dashboard','dashboard-types','record-types','discovery','timeline','record-content','record-selectors'].map(name=>'/api/workspace/read/'+name),
 ...['items','item','labels','bom-source','inventory/dashboard','inventory/discovery','inventory/stock','inventory/ledger','planning/dashboard','planning/discovery','planning/readiness'].map(name=>'/api/modules/'+name),
 ...['query','open','history/list','history/read','runs','runs/comparison','writing/read','values/read','values/figures','values/figure-copy-choices','values/figure-copy-source','values/attempt-context','runs/prepare'].map(name=>'/api/research/records/'+name),
 ...['owners','query','labels','resolve','incoming'].map(name=>'/api/modules/references/'+name),
 '/api/calendars/page','/api/calendars/event','/api/sharing/configuration','/api/sharing/figure',
 '/api/modules/drafts/read',
 '/api/laboratory/read/query','/api/laboratory/read/selected','/api/research/drafts/list','/api/modules/drafts/list'
]);
export const workspaceSnapshotRequest=(method,route)=>{
 const material=materialRequest(route);if(material)return method===material.method&&material.snapshot;
 const pdf=pdfDocumentRequest(route,method);if(pdf)return pdf.snapshot;
 const publication=projectPublicationRequest(route,method);if(publication)return publication.snapshot;
 const review=reviewRequest(route,method);if(review)return review.snapshot;
 if(method==='GET')return /^\/api\/live\/figures\/(?:[a-f0-9-]{36}\/){2}[a-f0-9-]{36}$/.test(route)||/^\/api\/sharing\/figures\/[a-f0-9-]{36}\/(?:base|incoming|current)\/[a-f0-9-]{36}\/[a-f0-9-]{36}$/.test(route)||get.has(route)||/^\/api\/fonts\/custom-[a-f0-9]{64}$/.test(route)||/^\/(?:appearance-preview|preview)\/[a-f0-9]{64}\/.+/.test(route)||/^\/api\/appearance-preview\/[a-f0-9]{64}\/pages$/.test(route);
 if(method!=='POST')return false;const command=recordStarterRequest(route)??researchRequest(route);return post.has(route)||route==='/api/research/views/list'||Boolean(command&&!command.write);
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
