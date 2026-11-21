import {randomUUID} from 'node:crypto';
import {WebsiteFilesCandidate} from '../../src/website-files-candidate.js';

// A saved website's files as the publishers receive them: the same candidate
// the website editor publishes. The stand-in store answers that the site is
// still at the candidate's revision.
export function websiteCandidate(files,{siteId=randomUUID(),revision=1,blockedValues=[]}={}){
 const store={checkRevision:async()=>{}};
 return new WebsiteFilesCandidate(store,siteId,revision,files instanceof Map?files:Object.entries(files),{blockedValues});
}
// A small website with one page for each record its lab books share.
export function bookWebsiteCandidate(book,options){
 const shared=new Set(book.notebooks.filter(n=>n.share!==false).map(n=>n.id));
 const page=(title,body)=>'<!doctype html><html lang="en"><head><meta charset="utf-8"><title>'+title+'</title><link rel="stylesheet" href="styles.css"></head><body><main><h1>'+title+'</h1>'+body+'</main></body></html>\n';
 const files=new Map([['index.html',page(book.title.replace(/[<&]/g,''),'<p>Shared records from the lab book.</p>')],['styles.css','body{font-family:system-ui}\n']]);
 for(const record of book.entries)if(record.share===true&&shared.has(record.notebookId))files.set('entries/'+record.id+'.html',page(record.title.replace(/[<&]/g,''),'<p>Record page.</p>'));
 return websiteCandidate(files,options);
}
