// Heading and anchor searches continue in bounded, authenticated windows.
// The cursor binds the exact record snapshot and the complete search request.
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {bookSelectors,selectorAnchor} from './web/book-selectors.js';
const invalid=()=>{throw new AppError('WORKSPACE_READ_CURSOR');};
export async function searchRecordSections(store,command,{etag,total,selected,page,signal}){
 const start=Math.min(command.after??0,total),needle=command.search?.trim().toLocaleLowerCase(),anchor=command.anchor;
 if(command.search!==undefined&&!needle)throw new AppError('INVALID');
 const request=digest(serialize({workspaceId:command.workspaceId,recordId:command.recordId,etag,search:command.search??null,anchor:anchor??null,start}));
 let scanned=0;
 if(command.cursor){
  let cursor;try{cursor=store.decode('record-section-search',command.workspaceId,Buffer.from(command.cursor,'base64url'));}catch{invalid();}
  if(!cursor||Object.keys(cursor).sort().join()!=='request,scanned,total,version'||cursor.version!==1||cursor.request!==request||cursor.total!==total||!Number.isSafeInteger(cursor.scanned)||cursor.scanned<1||cursor.scanned>=total)invalid();
  scanned=cursor.scanned;
 }
 const end=Math.min(total,scanned+64);
 for(;scanned<end;scanned++){
  signal?.throwIfAborted();const index=(start+scanned)%total,id=await selected(['sections',String(index),'id']);
  let matches=anchor&&(anchor===id||anchor==='record-section-'+id);
  if(needle)matches=(await selected(['sections',String(index),'title'])).toLocaleLowerCase().includes(needle);
  if(anchor?.startsWith('record-')&&!matches){
   const section=(await page(index,1)).values[0];
   const inlineFigure=node=>node?.attrs?.figureId&&'record-figure-'+node.attrs.figureId===anchor||(node?.content??[]).some(inlineFigure);
   matches=bookSelectors({body:'',sections:[section],figures:[],attachments:[]}).some(item=>selectorAnchor(item)===anchor)||inlineFigure(section.body);
  }
  if(matches)return {found:index,scanned:scanned+1,total,nextCursor:null};
 }
 return {found:null,scanned,total,nextCursor:scanned<total?store.encode('record-section-search',command.workspaceId,{version:1,request,scanned,total}).toString('base64url'):null};
}
