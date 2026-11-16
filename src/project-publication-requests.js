// Publication endpoints declare their owner and admission before execution.
// A project or lab book owner keeps its workspace edits, GitHub connection and
// the publishing settings Integrations reads; websites live in the website editor.
import {MAX_BYTES} from './web/workspace-limits.js';
const commands={
 'github-connection/':['status','start','cancel','choose','disconnect'],
 'publishing/':['connect','disconnect']
};
// Read-only operations that acquire a durable worker are deliberately excluded
// from snapshot admission. Preserve this subset rather than equating !write
// with safety during owner relocation or key retirement.
const reads=new Set(['github-connection/status']);
const snapshots=new Set(['github-connection/status']);
const controls=new Set(['github-connection/cancel']);
const policy=(publication,{method='POST',write=false,binary=false,snapshot=false,limit=MAX_BYTES,...extra}={})=>Object.freeze({publication,method,write,binary,limit,input:'json',
 schema:'publication-command:'+publication,authority:'unlocked-selected-owner',owner:'selected-website',admission:controls.has(publication)?'control':'work',snapshot,
 cancellation:'domain-managed-disconnect',output:binary?'private-download':'private-json',...extra});
const routes=Object.create(null);
for(const operation of ['workspace/save',...Object.entries(commands).flatMap(([prefix,names])=>names.map(name=>prefix+name))]){
 if(Object.hasOwn(routes,operation))throw Error('Duplicate publication route contract');
 routes[operation]=policy(operation,{write:!reads.has(operation),snapshot:snapshots.has(operation)});
}
routes['github-connection/status']=policy('github-connection/status',{snapshot:true,admission:'control',limit:1024});
routes.publishing=policy('publishing',{method:'GET',snapshot:true});
export const publicationRoutes=Object.freeze(routes);
export function projectPublicationRequest(route,method){
 const selected=route.startsWith('/api/')&&Object.hasOwn(routes,route.slice(5))?routes[route.slice(5)]:null;
 return !method||selected?.method===method?selected:null;
}
