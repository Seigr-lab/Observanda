// Publication endpoints declare their owner and admission before execution.
import {MAX_BYTES} from './web/workspace-limits.js';
import {publicationJobControlRoutes} from './publication-job-policy.js';
import {websiteEditorReads,websiteEditorOperations} from './website-editor-policy.js';
const commands={
 'github-connection/':['status','start','cancel','choose','disconnect'],
 'websites/':['list','open','version','change','save',...websiteEditorOperations.map(name=>'editor/'+name)],
 'website/research/':['summary','content','record','sections','media'],
 'publication-selections/':['open','checkpoint','read','window','discard'],
 'publication-jobs/':['start','list','open','pages','references','rollback-review','analysis-review','analysis-review-window'],
 'deployment-jobs/':['start','list','status','cancel','retry'],
 'repository-setup/':['start','review','initialize','current','status','cancel','retry'],
 'publishing/':['save','connect','disconnect','check','plan','plan-operation','plan-page','verify','verification','verification-cancel','verification-retry','deploy'],
 'local-export/':['plan','current','page','apply','discard'],
 'publication-links/':['read','save']
};
const reads=new Set(['publishing/plan-page','publication-selections/read','publication-selections/window',...websiteEditorReads.map(name=>'websites/editor/'+name),'github-connection/status','websites/list','websites/open','websites/version','publication-jobs/list','publication-jobs/open','publication-jobs/pages','publication-jobs/references','publication-jobs/analysis-review-window','deployment-jobs/list','deployment-jobs/status','repository-setup/current','repository-setup/status','publishing/verification','publication-links/read','publication-selection','publication-references','local-export/current','local-export/page']);
// Read-only operations that acquire a durable worker are deliberately excluded
// from snapshot admission. Preserve this subset rather than equating !write
// with safety during owner relocation or key retirement.
const snapshots=new Set(['publishing/plan-page','publication-selections/read','publication-selections/window',
 ...['open','window','item'].map(name=>'websites/editor/'+name),
 ...['summary','content','record','sections','media'].map(name=>'website/research/'+name),
 'github-connection/status','deployment-jobs/list','deployment-jobs/status','repository-setup/current','repository-setup/status','publishing/verification',
 'design-preview','appearance-preview','websites/list','websites/open','websites/version']);
const controls=new Set(['deployment-jobs/status','deployment-jobs/cancel','repository-setup/status','repository-setup/cancel',
 'publishing/verification','publishing/verification-cancel','github-connection/cancel']);
const policy=(publication,{method='POST',write=false,binary=false,snapshot=false,limit=MAX_BYTES,...extra}={})=>Object.freeze({publication,method,write,binary,limit,input:'json',
 schema:'publication-command:'+publication,authority:'unlocked-selected-owner',owner:'selected-website',admission:controls.has(publication)?'control':'work',snapshot,
 cancellation:'domain-managed-disconnect',output:binary?'private-download':'private-json',...extra});
const routes=Object.create(null);
for(const operation of ['preview','design-preview','appearance-preview','export','workspace/save','publication-selection','publication-references',...Object.entries(commands).flatMap(([prefix,names])=>names.map(name=>prefix+name))]){
 if(Object.hasOwn(routes,operation))throw Error('Duplicate publication route contract');
 routes[operation]=policy(operation,{write:!reads.has(operation)&&!operation.startsWith('website/research/')&&!['design-preview','appearance-preview','export'].includes(operation),binary:operation==='export',snapshot:snapshots.has(operation)});
}
for(const {operation,...control} of Object.values(publicationJobControlRoutes))routes['publication-jobs/'+operation]=policy('publication-jobs/'+operation,control);
// Review controls only inspect or change an existing durable job. Keep them
// available while ordinary requests wait for capacity; retries run in workers.
routes['publishing/plan-operation']=policy('publishing/plan-operation',{write:true,admission:'control',limit:1024});
routes.publishing=policy('publishing',{method:'GET',snapshot:true});
export const publicationRoutes=Object.freeze(routes);
export function projectPublicationRequest(route,method){
 const selected=select(route);return !method||selected?.method===method?selected:null;
}
function select(route){
 if(!route.startsWith('/api/'))return null;const operation=route.slice(5);
 if(Object.hasOwn(routes,operation))return routes[operation];
 const appearance=/^appearance-preview\/([a-f0-9]{64})\/(.+)$/.exec(operation);
 if(appearance)return policy(appearance[2]==='pages'?'appearance-pages':'appearance-file',{id:appearance[1],file:appearance[2],method:'GET',binary:appearance[2]!=='pages',snapshot:appearance[2]==='pages'});
 const preview=/^publication-preview\/([a-f0-9]{64})\/(.+)$/.exec(operation),download=/^export\/([a-f0-9]{64})$/.exec(operation);
 if(preview||download)return policy(preview?'file':'export',{id:(preview??download)[1],file:preview?.[2],method:'GET',binary:true});
 return null;
}
