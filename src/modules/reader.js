import {moduleQuerySource,moduleQueryRevision} from './query-source.js';
import {queryResultWindow} from '../query-result-window.js';
import {moduleDomainContext} from '../module-domain-context.js';
import {validResourceTags} from '../web/modules/resource-tags.js';
import {AppError} from '../errors.js';
import {digest} from '../storage-format.js';
import {summaryPage} from '../summary-page.js';
import {ModuleCatalogue} from './catalogue.js';
import {ModuleBrowseIndex} from './browse-index.js';
import {moduleBrowsePage} from './browse-page.js';
import {workspaceModules} from './index.js';
import {moduleView,moduleSearch} from './view.js';
import {uuid} from './validation.js';
import {moduleReferences} from './references.js';
import {projectUsesTool} from '../web/project-tools.js';
import {inScope} from '../web/modules/scope.js';
import {moduleConstraint} from './constraints.js';
import {calendarFacts} from '../calendar/facts.js';
import {inventoryScopeItems} from './inventory-query.js';
import {inventoryScope} from '../web/modules/inventory-model.js';
import {inventoryFacts} from './inventory-facts.js';
const invalid=()=>{throw new AppError('MODULE_QUERY_CURSOR');};
const order=(a,b)=>{const x=a.title.toLowerCase(),y=b.title.toLowerCase();return x<y?-1:x>y?1:a.id<b.id?-1:a.id>b.id?1:0;};
export class ModuleReader{
 constructor(workspace,{context,domains=null}={}){this.workspace=workspace;this.modules=workspaceModules(workspace);this.readContext=context;this.readDomains=domains;}
 async context(workspaceId,operation){
  if(!uuid(workspaceId))throw new AppError('INVALID');
  if(this.readContext)return this.readContext(workspaceId,operation);
  if(await this.workspace.storageKind()==='catalogue')return this.workspace.catalogue(async store=>{
   const {metadata:book}=await store.snapshot();if(book.id!==workspaceId)throw new AppError('WORKSPACE_CHANGED');
   const owned=await moduleDomainContext(store,operation,{domains:this.readDomains});if(owned)return owned.value;
   const catalogue=new ModuleCatalogue(store),head=await catalogue.head(workspaceId);
   return operation({book,head,stockProjection:()=>catalogue.stockProjection(head),browse:async options=>{const plan=await new ModuleBrowseIndex(catalogue).plan(head,options);return plan?[plan]:null;},members:options=>catalogue.members(head,options),member:id=>catalogue.member(head,id),view:member=>catalogue.view(head,member),search:member=>catalogue.search(head,member),references:member=>catalogue.references(head,member),constraint:member=>catalogue.constraint(head,member),calendar:member=>catalogue.calendar(head,member),inventory:member=>catalogue.inventory(head,member),selected:id=>catalogue.selected(head,id),
    encode:value=>store.encode('module-page',workspaceId,value).toString('base64url'),decode:value=>store.decode('module-page',workspaceId,Buffer.from(value,'base64url'))});
  });
  const data=await this.modules.current();if(data.workspaceId!==workspaceId)throw new AppError('WORKSPACE_CHANGED');
  return operation({book:(await this.workspace.outline()).metadata,head:data,members:()=>data.entities,member:async id=>data.entities.find(e=>e.id===id)??null,view:async member=>moduleView(member),search:async member=>moduleSearch(member),references:async member=>moduleReferences(member),constraint:async member=>moduleConstraint(member),calendar:async member=>calendarFacts(member),inventory:async member=>inventoryFacts(member),selected:async id=>data.entities.find(e=>e.id===id)??null,
   encode:value=>Buffer.from(JSON.stringify(value)).toString('base64url'),decode:value=>JSON.parse(Buffer.from(value,'base64url'))});
 }
 async list({workspaceId,type=null,types=null,reference=null,query='',status='',tags=[],tagMode='all',kind=null,archived=null,moduleId=null,projectId=null,scopeIds=null,key=null,keys=null,resourceId=null,sort='title',recursive=true,cursor=null,limit=25},{signal,consume,referenceNamespaces=null}={}){
  if(!validResourceTags(tags)||!['all','any'].includes(tagMode)||tags.length&&type!=='resource')throw new AppError('RESOURCE_TAGS');
  if(!['title','created-desc'].includes(sort))throw new AppError('INVALID');
  if(type!==null&&!Object.hasOwn(this.modules.definitions.types,type)||typeof query!=='string'||query.length>256||typeof status!=='string'||status.length>80||!Number.isSafeInteger(limit)||limit<1||limit>25||cursor!==null&&(typeof cursor!=='string'||cursor.length>8192))throw new AppError('INVALID');
  if(types!==null&&(!Array.isArray(types)||types.length>40||new Set(types).size!==types.length||!types.every(t=>Object.hasOwn(this.modules.definitions.types,t))))throw new AppError('INVALID');
  if(reference!==null&&(!uuid(reference.id)||!uuid(reference.workspaceId)||!['record','project','notebook',...Object.keys(this.modules.definitions.types)].includes(reference.type)))throw new AppError('INVALID');
  if(kind!==null&&(type!=='resource'||!['object','material','equipment','software'].includes(kind))||archived!==null&&(!['calendar','category'].includes(type)||typeof archived!=='boolean')||moduleId!==null&&!['planning','resources'].includes(moduleId)||projectId!==null&&!uuid(projectId)||typeof recursive!=='boolean')throw new AppError('INVALID');
  if(resourceId!==null&&!uuid(resourceId)||keys!==null&&(!Array.isArray(keys)||keys.length>4096||new Set(keys).size!==keys.length||!keys.every(uuid)))throw new AppError('INVALID');
  if(key!==null&&!uuid(key)||scopeIds!==null&&(!Array.isArray(scopeIds)||scopeIds.length>10000||new Set(scopeIds).size!==scopeIds.length||!scopeIds.every(id=>id===null||uuid(id))))throw new AppError('INVALID');
  if(referenceNamespaces!==null&&(!reference||!Array.isArray(referenceNamespaces)||referenceNamespaces.length<1||new Set(referenceNamespaces).size!==referenceNamespaces.length||!referenceNamespaces.every(uuid)))throw new AppError('INVALID');

  const queryHash=digest(JSON.stringify({workspaceId,type,types,reference,referenceNamespaces,query,status,tags,tagMode,kind,archived,moduleId,projectId,scopeIds,key,keys,resourceId,sort,recursive,limit}));
  return this.context(workspaceId,async c=>{
   const scopeRevision=moduleQueryRevision(c);let anchor;try{anchor=cursor?c.decode(cursor):{workspaceId,revision:c.head.revision,scopeRevision,queryHash,limit,offset:0};}catch{invalid();}
   if(!anchor||anchor.workspaceId!==workspaceId||anchor.revision!==c.head.revision||anchor.scopeRevision!==scopeRevision||anchor.queryHash!==queryHash||anchor.limit!==limit||!Number.isSafeInteger(anchor.offset)||anchor.offset<0||anchor.offset>0&&(!uuid(anchor.after?.id)||typeof anchor.after.title!=='string'))invalid();
   if(anchor.offset&&sort==='created-desc'&&!Number.isFinite(Date.parse(anchor.after.createdAt)))invalid();
   const compare=sort==='title'?order:(a,b)=>b.createdAt.localeCompare(a.createdAt)||(a.id<b.id?-1:a.id>b.id?1:0);
   const result=({records:items,total,after,previousAfter})=>{const next=anchor.offset+items.length;return {workspaceId,revision:c.head.revision,items,total,offset:anchor.offset,cursor:c.encode(anchor),
    nextCursor:next<total?c.encode({...anchor,offset:next,after}):null,
    previousCursor:anchor.offset?c.encode({...anchor,offset:Math.max(0,anchor.offset-limit),...(anchor.offset>limit?{after:previousAfter}:{after:null})}):null};};
   const filtered=!!status||kind!==null||tags.length>0,canSeek=!consume&&!reference&&!query&&archived===null&&(moduleId===null||moduleId==='resources'&&recursive)&&projectId===null&&scopeIds===null&&key===null&&keys===null&&resourceId===null;
   const browseOptions={types:type?(types&&!types.includes(type)?[]:[type]):types,sort,status,kind,tags,tagMode,signal};let plans=null;
   if(c.browse&&key===null&&keys===null&&(canSeek||filtered)){
    plans=await c.browse({...browseOptions,after:canSeek&&anchor.offset?anchor.after:null});
    if(canSeek&&plans&&plans.every(plan=>!filtered||plan.exact===true))return result(await moduleBrowsePage(plans,{...anchor,order:compare,signal}));
    // Residual filters still compute exact totals. Start at the beginning of
    // the smaller proved candidate range, including backward-page witnesses.
    if(canSeek&&plans&&anchor.offset)plans=await c.browse({...browseOptions,after:null});
   }
   const page=summaryPage({...anchor,order:compare,point:v=>({id:v.id,title:v.title,createdAt:v.createdAt})});
   const source=(check=()=>{})=>moduleQuerySource(c,{workspaceId,type,types,reference,query,status,tags,tagMode,kind,archived,moduleId,projectId,scopeIds,key,keys,resourceId,recursive,plans,referenceNamespaces},{signal,check});
   const point=view=>({id:view.id,title:view.title,createdAt:view.createdAt});
   if(consume)return consume({source,context:c,queryHash,revision:scopeRevision,order:compare,point});
   const cached=key||keys?null:await queryResultWindow({workspace:this.workspace,ownerId:workspaceId,snapshotId:scopeRevision,queryHash:digest('module:'+queryHash),order:compare,point,after:anchor.offset?anchor.after:null,limit,preceding:anchor.offset>limit,reuse:!!cursor,signal},check=>({rows:source(check)}));
   if(cached){if(cached.skipped!==anchor.offset||anchor.offset&&!cached.records.length)invalid();return result({...cached,after:cached.records.length?point(cached.records.at(-1)):null,previousAfter:cached.preceding[0]??null});}
   for await(const view of source())page.add(view);
   let pageData;try{pageData=page.finish();}catch(error){if(error.code==='RECORD_QUERY_CURSOR')invalid();throw error;}
   return result(pageData);
  });
 }
 async selected({workspaceId,id},{signal}={}){
  if(!uuid(id))throw new AppError('INVALID');
  return this.context(workspaceId,async c=>{
   signal?.throwIfAborted();
   const entity=await c.selected(id);if(!entity)throw new AppError('NOT_FOUND');this.modules.validateEntity(entity);
   return {workspaceId,revision:c.head.revision,entity};
  });
 }
 async labels({workspaceId,ids},{signal}={}){
  if(!Array.isArray(ids)||ids.length>25||!ids.every(uuid)||new Set(ids).size!==ids.length)throw new AppError('INVALID');
  return this.context(workspaceId,async c=>{
   const items=[],missing=[];
   for(const id of ids){signal?.throwIfAborted();const member=await c.member(id);if(member)items.push(await c.view(member));else missing.push(id);}
   return {workspaceId,revision:c.head.revision,items,missing};
  });
 }
}
