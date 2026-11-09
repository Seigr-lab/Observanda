import {AppError} from './errors.js';
import {WebsiteFilesCandidate} from './website-files-candidate.js';
import {publicationText} from './web/publication-messages.js';

const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);

// A withdrawal edition replaces every file this workspace delivered with one
// notice page. It contains no website content, so it cannot carry withdrawn
// sources or drafts, and its bytes are identical for every website. Generated
// sites use the edition's English interface, as other published viewer text.
export function withdrawalNotice(){
 const title=escape(publicationText('withdrawnTitle')),text=escape(publicationText('withdrawnText'));
 return '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="robots" content="noindex">\n<title>'+title+'</title>\n'+
  '<style>body{margin:0;font:1rem/1.5 system-ui,sans-serif;color:#1f2933;background:#fff}main{max-width:40rem;margin:4rem auto;padding:0 1.5rem}</style>\n</head>\n'+
  '<body>\n<main>\n<h1>'+title+'</h1>\n<p>'+text+'</p>\n</main>\n</body>\n</html>\n';
}
export const websiteEditions=new Set(['website','withdrawal']);
export function withdrawalCandidate(store,siteId,revision,options){
 const candidate=new WebsiteFilesCandidate(store,siteId,revision,[['index.html',Buffer.from(withdrawalNotice())]],options);
 candidate.edition='withdrawal';return candidate;
}
let withdrawalId;
export function isWithdrawalRelease(releaseId){
 withdrawalId??=withdrawalCandidate(null,null,null).id;
 return releaseId===withdrawalId;
}
// Each operation resolves the edition again against the current saved
// revision. A withdrawal review cannot be applied to a later revision either.
export async function websiteEdition(store,siteId,revision,edition='website',options){
 if(!websiteEditions.has(edition))throw new AppError('INVALID');
 if(edition==='website'){const candidate=await WebsiteFilesCandidate.open(store,siteId,revision,options);candidate.edition='website';return candidate;}
 await store.checkRevision(siteId,revision);
 return withdrawalCandidate(store,siteId,revision,options);
}
