import {createNotebook,validateNotebook} from '../model.js';
import {exact,uuid,instant} from '../modules/validation.js';
import {exchangeContact} from './exchange-identity.js';
import {AppError} from '../errors.js';

// A shared copy carries research structure, never the owner's website,
// integration settings, organization authority, stock or workspace keys.
export function selectedMetadata(source,notebookIds){
 const book=createNotebook(source.title),selected=new Set(notebookIds);
 book.id=source.id;book.createdAt=source.createdAt;book.updatedAt=source.updatedAt;
 book.notebooks=structuredClone(source.notebooks.filter(n=>selected.has(n.id)));
 const projectIds=new Set(book.notebooks.map(n=>n.projectId));
 book.projects=source.projects.filter(p=>projectIds.has(p.id)).map(p=>({id:p.id,title:p.title,description:'',share:false,logoId:null,...(p.parentId!==undefined?{parentId:null}:{}),...(p.kind!==undefined?{kind:p.kind}:{})}));
 return validateNotebook(book);
}
export function validateSelection(value){
 const fail=()=>{throw new AppError('COLLABORATION_PACKAGE');};
 if(!exact(value,['version','kind','id','baseId','edition','createdAt','grant','owner','recipient','metadata'])||value.version!==1||!['offer','changes'].includes(value.kind)||!uuid(value.id)||!(value.baseId===null||uuid(value.baseId))||!Number.isSafeInteger(value.edition)||value.edition<1||!instant(value.createdAt))fail();
 const g=value.grant;
 if(!exact(g,['id','generation','organizationId','principalId','role'])||!uuid(g.id)||!uuid(g.organizationId)||!uuid(g.principalId)||!Number.isSafeInteger(g.generation)||g.generation<1||!['reader','editor'].includes(g.role))fail();
 exchangeContact(value.owner);exchangeContact(value.recipient);
 if(value.kind==='offer'&&value.baseId!==null||value.kind==='changes'&&value.baseId===null)fail();
 validateNotebook(value.metadata);
 if(value.metadata.entries.length||!value.metadata.notebooks.length||JSON.stringify(selectedMetadata(value.metadata,value.metadata.notebooks.map(n=>n.id)))!==JSON.stringify({...value.metadata,revision:0})){
  // Compare only the intentional projection. Generated default timestamps are
  // replaced by source timestamps in selectedMetadata.
  fail();
 }
 return value;
}
