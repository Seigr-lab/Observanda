import {moduleDomainContext} from '../module-domain-context.js';
import {validResourceTags,matchesResourceTags} from '../web/modules/resource-tags.js';
import {AppError} from '../errors.js';
import {digest} from '../storage-format.js';
import {summaryPage} from '../summary-page.js';
import {ModuleCatalogue} from './catalogue.js';
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
   return operation({book,head,members:options=>catalogue.members(head,options),member:id=>catalogue.member(head,id),view:member=>catalogue.view(head,member),search:member=>catalogue.search(head,member),references:member=>catalogue.references(head,member),constraint:member=>catalogue.constraint(head,member),calendar:member=>catalogue.calendar(head,member),inventory:member=>catalogue.inventory(head,member),selected:id=>catalogue.selected(head,id),
    encode:value=>store.encode('module-page',workspaceId,value).toString('base64url'),decode:value=>store.decode('module-page',workspaceId,Buffer.from(value,'base64url'))});
  });
  const data=await this.modules.current();if(data.workspaceId!==workspaceId)throw new AppError('WORKSPACE_CHANGED');
  return operation({book:(await this.workspace.outline()).metadata,head:data,members:()=>data.entities,member:async id=>data.entities.find(e=>e.id===id)??null,view:async member=>moduleView(member),search:async member=>moduleSearch(member),references:async member=>moduleReferences(member),constraint:async member=>moduleConstraint(member),calendar:async member=>calendarFacts(member),inventory:async member=>inventoryFacts(member),selected:async id=>data.entities.find(e=>e.id===id)??null,
   encode:value=>Buffer.from(JSON.stringify(value)).toString('base64url'),decode:value=>JSON.parse(Buffer.from(value,'base64url'))});
 }
 async list({workspaceId,type=null,types=null,reference=null,query='',status='',tags=[],tagMode='all',kind=null,archived=null,moduleId=null,projectId=null,scopeIds=null,key=null,keys=null,resourceId=null,sort='title',recursive=true,cursor=null,limit=25},{signal,collect,referenceNamespaces=null}={}){
  if(!validResourceTags(tags)||!['all','any'].includes(tagMode)||tags.length&&type!=='resource')throw new AppError('RESOURCE_TAGS');
  if(!['title','created-desc'].includes(sort))throw new AppError('INVALID');
  if(type!==null&&!Object.hasOwn(this.modules.definitions.types,type)||typeof query!=='string'||query.length>256||typeof status!=='string'||status.length>80||!Number.isSafeInteger(limit)||limit<1||limit>25||cursor!==null&&(typeof cursor!=='string'||cursor.length>8192))throw new AppError('INVALID');
  if(types!==null&&(!Array.isArray(types)||types.length>40||new Set(types).size!==types.length||!types.every(t=>Object.hasOwn(this.modules.definitions.types,t))))throw new AppError('INVALID');
  if(reference!==null&&(!uuid(reference.id)||!uuid(reference.workspaceId)||!['record','project','notebook',...Object.keys(this.modules.definitions.types)].includes(reference.type)))throw new AppError('INVALID');
  if(kind!==null&&(type!=='resource'||!['object','material','equipment','software'].includes(kind))||archived!==null&&(!['calendar','category'].includes(type)||typeof archived!=='boolean')||moduleId!==null&&!['planning','resources'].includes(moduleId)||projectId!==null&&!uuid(projectId)||typeof recursive!=='boolean')throw new AppError('INVALID');
  if(resourceId!==null&&!uuid(resourceId)||keys!==null&&(!Array.isArray(keys)||keys.length>4096||new Set(keys).size!==keys.length||!keys.every(uuid)))throw new AppError('INVALID');
  if(key!==null&&!uuid(key)||scopeIds!==null&&(!Array.isArray(scopeIds)||scopeIds.length>10000||new Set(scopeIds).size!==scopeIds.length||!scopeIds.every(id=>id===null||uuid(id))))throw new AppError('INVALID');
  if(referenceNamespaces!==null&&(!reference||!Array.isArray(referenceNamespaces)||referenceNamespaces.length<1||new Set(referenceNamespaces).size!==referenceNamespaces.length||!referenceNamespaces.every(uuid)))throw new AppError('INVALID');
  const namespaces=new Set(referenceNamespaces??(reference?[reference.workspaceId]:[]));
  const queryHash=digest(JSON.stringify({workspaceId,type,types,reference,referenceNamespaces,query,status,tags,tagMode,kind,archived,moduleId,projectId,scopeIds,key,keys,resourceId,sort,recursive,limit}));
  return this.context(workspaceId,async c=>{
   let anchor;try{anchor=cursor?c.decode(cursor):{workspaceId,revision:c.head.revision,queryHash,limit,offset:0};}catch{invalid();}
   if(!anchor||anchor.workspaceId!==workspaceId||anchor.revision!==c.head.revision||anchor.queryHash!==queryHash||anchor.limit!==limit||!Number.isSafeInteger(anchor.offset)||anchor.offset<0||anchor.offset>0&&(!uuid(anchor.after?.id)||typeof anchor.after.title!=='string'))invalid();
   if(anchor.offset&&sort==='created-desc'&&!Number.isFinite(Date.parse(anchor.after.createdAt)))invalid();
   const page=summaryPage({...anchor,order:sort==='title'?order:(a,b)=>b.createdAt.localeCompare(a.createdAt)||(a.id<b.id?-1:a.id>b.id?1:0),point:v=>({id:v.id,title:v.title,createdAt:v.createdAt})}),needle=query.toLowerCase(),scope=scopeIds&&new Set(scopeIds);
   const stockScope=moduleId==='resources'?(scope??inventoryScope(c.book,projectId,recursive)):null;
   // Explicit selections are already bounded by the public query limit. Read
   // their authenticated members directly, preserving strict keys validation
   // even when another filter would hide a missing selected item.
   let selected=null;
   if(keys){
    selected=[];
    for(const id of keys){signal?.throwIfAborted();const member=await c.member(id);if(!member)throw new AppError('NOT_FOUND');const view=await c.view(member);if(view.type!==type)throw new AppError('NOT_FOUND');selected.push({member,view});}
   }else if(key){
    signal?.throwIfAborted();let member;
    try{member=await c.member(key);}catch(error){if(error.code!=='MODULE_REFERENCE')throw error;}
    // An ID outside the admitted domain was absent from the old traversal too.
    selected=member?[{member}]:[];
   }
   const stockItems=moduleId==='resources'&&!keys&&(!type||type==='resource')&&(!types||types.includes('resource'))?await inventoryScopeItems(c,stockScope,{signal}):null;
   async function* candidates(){if(selected)yield* selected;else for await(const member of c.members({signal,types:type?[type]:types}))yield {member};}
   for await(const {member,view:selectedView} of candidates()){
    signal?.throwIfAborted();if(key&&member.id!==key||keys&&!keys.includes(member.id)||type&&member.type&&member.type!==type||types&&member.type&&!types.includes(member.type))continue;
    if(resourceId&&(await c.constraint(member)).data.resourceId!==resourceId)continue;
    if(kind!==null&&(await c.constraint(member)).data.kind!==kind||archived!==null&&(await (type==='category'?c.inventory(member):c.calendar(member)))?.data.archived!==archived)continue;
    if(moduleId==='resources'){
     if(stockScope){
      const facts=await c.constraint(member),d=facts.data;
      if(facts.type!=='category'&&!stockScope.size)continue;
      if(facts.type==='resource'){if(!keys&&stockItems&&!stockItems.has(member.id))continue;}
      else if(facts.type!=='category'){
       if(['stock-transfer','asset-transfer'].includes(facts.type)){
        const value=facts.type==='asset-transfer'?(await c.inventory(member)).data:d;
        if(!stockScope.has(value.fromProjectId)&&!stockScope.has(value.toProjectId))continue;
       }else{
        const refs=await c.references(member),parent=refs.ownerId&&await c.member(refs.ownerId),owner=parent?(await c.references(parent)).projectId:refs.projectId;
        if(!stockScope.has(owner??null))continue;
       }
      }
     }
    }else if(moduleId||projectId||scope){
     const facts=await c.references(member),parent=facts.ownerId&&await c.member(facts.ownerId),owner=parent?(await c.references(parent)).projectId:facts.projectId;
     if(moduleId&&!projectUsesTool(c.book,owner,moduleId)||scope&&!scope.has(owner??null)||!inScope(c.book,owner,projectId,recursive))continue;
    }
    if(reference){
     const facts=await c.references(member);let linked=facts.links.some(r=>namespaces.has(r.workspaceId)&&r.type===reference.type&&r.id===reference.id);
     if(!linked&&reference.type==='resource'&&reference.workspaceId===workspaceId){const constraint=await c.constraint(member);linked=constraint.data.resourceId===reference.id||constraint.type==='bom'&&constraint.data.lines.some(line=>line.resourceId===reference.id);}
     if(!linked)continue;
     if(['task','booking','calendar','event','subscription','calendar-connection'].includes(member.type)){
      const parent=facts.ownerId&&await c.member(facts.ownerId),owner=parent?(await c.references(parent)).projectId:facts.projectId;
      if(!projectUsesTool(c.book,owner,'planning'))continue;
     }
    }
    const view=selectedView??await c.view(member);if(type&&view.type!==type||types&&!types.includes(view.type)||status&&view.status!==status)continue;
    if(tags.length&&!matchesResourceTags(view.tags,tags,tagMode))continue;
    if(needle&&!(await c.search(member)).includes(needle))continue;
    collect?.(view);page.add(view);
   }
   let pageData;try{pageData=page.finish();}catch(error){if(error.code==='RECORD_QUERY_CURSOR')invalid();throw error;}
   const {records:items,total,after,previousAfter}=pageData,next=anchor.offset+items.length;
   return {workspaceId,revision:c.head.revision,items,total,offset:anchor.offset,cursor:c.encode(anchor),
    nextCursor:next<total?c.encode({...anchor,offset:next,after}):null,
    previousCursor:anchor.offset?c.encode({...anchor,offset:Math.max(0,anchor.offset-limit),...(anchor.offset>limit?{after:previousAfter}:{after:null})}):null};
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
