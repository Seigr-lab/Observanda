import {publicationSourceRevision} from './publication-source-context.js';
import {websiteSnapshot} from './website-context.js';
import {t} from './i18n/index.js';
import {WEBSITE_PAGE_LIMIT,websiteRecordPages} from './website-page-query.js';
import {websitePageWindow} from './website-page-targets.js';

// Structural destinations come from the live presentation draft; record labels
// come from its pinned saved snapshot. Neither is an editable record original.
// A transition window holds at most 25 structural and 25 record destinations.
export function websiteLinkDestinations({state,api,documents,pageBook=()=>state.book,structurePages=options=>websitePageWindow(pageBook(),options),recordPages=options=>websiteRecordPages({state,api,...options})}){
 return async({query='',cursor=null,signal}={})=>{
  signal?.throwIfAborted();if(documents?.enabled())await documents.flush();
  const documentSnapshot=documents?.enabled()?documents.snapshot():null;
  const {book,etag}=state,contextId=websiteSnapshot(state),consent=publicationSourceRevision(state),search=query.trim().toLocaleLowerCase();
  const anchor={workspaceId:book.id,etag,contextId,consent,search,documentSnapshot},limit=WEBSITE_PAGE_LIMIT;
  if(cursor&&(Object.entries(anchor).some(([key,value])=>cursor[key]!==value)||!['structure','records'].includes(cursor.phase)||!Number.isSafeInteger(cursor.offset)||cursor.offset<0||cursor.offset%limit))throw Error(t('websitePages','invalid'));
  const token=(phase,offset,recordCursor=null)=>({...anchor,phase,offset,recordCursor});
  const offset=cursor?.offset??0,structure=await structurePages({kind:'structure',search,offset:cursor?.phase==='records'?0:offset,limit,signal});
  const lastStructure=structure.total?Math.floor((structure.total-1)/limit)*limit:0;
  if(offset>lastStructure||cursor?.phase==='records'&&offset!==lastStructure)throw Error(t('websitePages','invalid'));
  let items=[],previousCursor=null,nextCursor=null;
  if(cursor?.phase!=='records'&&structure.nextCursor!==null){
   items=structure.items;previousCursor=offset?token('structure',offset-limit):null;nextCursor=token('structure',offset+limit);
  }else{
   const records=await recordPages({search,cursor:cursor?.phase==='records'?cursor.recordCursor:null,signal});
   signal?.throwIfAborted();
   if(documents?.enabled()&&documents.snapshot()!==documentSnapshot||state.book?.id!==book.id||state.etag!==etag||websiteSnapshot(state)!==contextId||publicationSourceRevision(state)!==consent)throw new DOMException('Link destination context changed','AbortError');
   items=cursor?.phase==='records'?records.items:[...structure.items,...records.items];
   previousCursor=records.offset>limit?token('records',lastStructure,records.previousCursor):records.offset?token('structure',lastStructure):offset?token('structure',offset-limit):null;
   nextCursor=records.nextCursor!==null?token('records',lastStructure,records.nextCursor):null;
  }
  return {items:items.map(item=>({href:item.target,label:item.target==='home'?t('websitePages','home'):item.title,context:item.target==='home'?'':item.context??t('websitePages',item.target.split(':')[0])})),previousCursor,nextCursor};
 };
}
