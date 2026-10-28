// Transport, owner dispatch and service admission share this policy. Document,
// source-permission and exact-revision validation remain in the owning handlers.
const reads=['list','archive','openArchived','open','sections','outline','section','history','capabilities','export','layouts','source','source-images','selection','preflight','fonts','font-read','image-read','exports','export-status','export-download'];
const writes=['print-profile-import','change','layout-change','source-retain','source-image-retain','font-retain','image-import','export-start','export-cancel','export-resume'];
const binaries=new Set(['export','image-read','font-read','export-download']);
const controls=new Set(['export-status','export-cancel']);
const routes=Object.create(null);
for(const [write,names] of [[false,reads],[true,writes]])for(const pdf of names){
 if(Object.hasOwn(routes,pdf))throw Error('Duplicate PDF route contract');
 const binary=binaries.has(pdf);
 routes[pdf]=Object.freeze({pdf,method:'POST',input:'json',schema:controls.has(pdf)?'owned-pdf-export-id':'pdf-command:'+pdf,
  limit:controls.has(pdf)?1024:pdf==='image-import'?24*1024*1024:pdf==='print-profile-import'?12*1024*1024:1024*1024,
  write,binary,authority:'unlocked-selected-owner',owner:'selected-publication-owner',admission:controls.has(pdf)?'control':'work',
  snapshot:!write,cancellation:'domain-managed-disconnect',output:binary?'private-download':'private-json'});
}
export const pdfDocumentRoutes=Object.freeze(routes);
export function pdfDocumentRequest(route,method='POST'){
 const prefix='/api/pdf/';if(method!=='POST'||!route.startsWith(prefix))return null;
 const pdf=route.slice(prefix.length);return Object.hasOwn(routes,pdf)?routes[pdf]:null;
}
