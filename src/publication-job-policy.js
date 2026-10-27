// One policy and execution boundary for workspace and independently owned
// website job controls. Owning queues still enforce the selected website.
export const publicationJobControlRoutes=Object.freeze(Object.fromEntries([
 ['status','publication.prepare','status'],['cancel','publication.prepare','cancel'],['retry','publication.prepare','retry'],['diagnostics','publication.prepare','diagnostics'],
 ['analysis-review-status','publication.analysis-review','status'],['analysis-review-cancel','publication.analysis-review','cancel'],['analysis-review-retry','publication.analysis-review','retry'],['analysis-review-diagnostics','publication.analysis-review','diagnostics']
].map(([operation,jobType,action])=>[operation,Object.freeze({operation,method:'POST',input:'json',schema:'owned-job-id-and-optional-attempt',limit:1024,authority:'unlocked-selected-owner',owner:'selected-website',jobType,action,write:action==='cancel'||action==='retry',admission:['status','cancel'].includes(action)?'control':'work',snapshot:false,cancellation:'check-before-mutation',output:action==='diagnostics'?'private-job-diagnostic':'redacted-job-summary'})])));

export function publicationJobControlRequest(route){
 const prefix='/api/publication-jobs/';if(!route.startsWith(prefix))return null;
 const name=route.slice(prefix.length);return Object.hasOwn(publicationJobControlRoutes,name)?publicationJobControlRoutes[name]:null;
}
