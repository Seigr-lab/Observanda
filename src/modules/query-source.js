import {AppError} from '../errors.js';
import {matchesResourceTags} from '../web/modules/resource-tags.js';
import {projectUsesTool} from '../web/project-tools.js';
import {inScope} from '../web/modules/scope.js';
import {inventoryScope,stockTracked,assetPlacement} from '../web/modules/inventory-model.js';
import {digest} from '../storage-format.js';
export const moduleQueryRevision=context=>digest(JSON.stringify([context.head.revision,context.book.projects,context.book.notebooks]));
function stockMembership(context,scope,{signal,check}){
 let prepared;return async(resource)=>{
  if(!scope.size)return false;const plans=await (prepared??=Promise.resolve(context.stockProjection?.()));
  if(plans){for(const {index,head} of plans)for(const place of scope){check();signal?.throwIfAborted();if(await index.get(head,'scope:'+(place===null?'-':place)+':'+resource.id))return true;}return false;}
  // Historical catalogues without the projection remain exact and bounded.
  // Current catalogues use authenticated point proofs above; no query builds
  // a resource-sized membership set, including the fallback under pressure.
  if(scope.has(stockTracked(resource.data)?resource.data.projectId??null:assetPlacement(resource)))return true;
  for await(const member of context.members({signal,types:['movement','reservation','stock-transfer']})){
   check();signal?.throwIfAborted();if(member.type&&!['movement','reservation','stock-transfer'].includes(member.type))continue;
   const {type,data}=await context.constraint(member);if(data.resourceId!==resource.id)continue;
   if(type==='stock-transfer'&&(scope.has(data.fromProjectId)||scope.has(data.toProjectId))||['movement','reservation'].includes(type)&&Object.hasOwn(data,'projectId')&&scope.has(data.projectId))return true;
  }return false;
 };
}
// A single bounded iterator owns module predicates and per-candidate fact reuse.
// Consumers must exhaust or return it inside the admitted catalogue context.
export async function* moduleQuerySource(c,{workspaceId,type,types,reference,query,status,tags,tagMode,kind,archived,moduleId,projectId,scopeIds,key,keys,resourceId,recursive,plans,referenceNamespaces},{signal,check=()=>{}}={}){
 const needle=query.toLowerCase(),scope=scopeIds&&new Set(scopeIds),namespaces=new Set(referenceNamespaces??(reference?[reference.workspaceId]:[]));
   const stockScope=moduleId==='resources'?(scope??inventoryScope(c.book,projectId,recursive)):null;
   // Explicit selections are already bounded by the public query limit. Read
   // their authenticated members directly, preserving strict keys validation
   // even when another filter would hide a missing selected item.
   let selected=null;
   if(keys){
    selected=[];
    for(const id of keys){check();signal?.throwIfAborted();const member=await c.member(id);if(!member)throw new AppError('NOT_FOUND');const view=await c.view(member);if(view.type!==type)throw new AppError('NOT_FOUND');selected.push({member,view});}
   }else if(key){
    check();signal?.throwIfAborted();let member;
    try{member=await c.member(key);}catch(error){if(error.code!=='MODULE_REFERENCE')throw error;}
    // An ID outside the admitted domain was absent from the old traversal too.
    selected=member?[{member}]:[];
   }
   const inStockScope=stockScope?stockMembership(c,stockScope,{signal,check}):null;
   async function* candidates(){
    if(selected)yield* selected;
    else if(plans){for(const plan of plans){if(plan.candidates)yield* plan.candidates();else for await(const view of plan.rows()){const member=await c.member(view.id);if(!member)throw new AppError('CATALOGUE_DAMAGED');yield {member,view};}}}
    else for await(const member of c.members({signal,types:type?[type]:types}))yield {member};
   }
   for await(const {member,view:selectedView,constraint:selectedConstraint} of candidates()){
    check();signal?.throwIfAborted();if(key&&member.id!==key||keys&&!keys.includes(member.id)||type&&member.type&&member.type!==type||types&&member.type&&!types.includes(member.type))continue;
    // Facts are immutable within this read context. Reuse only this candidate's
    // values, so compound filters never re-decode the same supporting object.
    const facts=new Map(selectedConstraint?[['constraint',selectedConstraint]]:[]),fact=name=>{if(!facts.has(name))facts.set(name,c[name](member));return facts.get(name);};
    if(resourceId&&(await fact('constraint')).data.resourceId!==resourceId)continue;
    if(kind!==null&&(await fact('constraint')).data.kind!==kind||archived!==null&&(await fact(type==='category'?'inventory':'calendar'))?.data.archived!==archived)continue;
    if(moduleId==='resources'){
     if(stockScope){
      const constraint=await fact('constraint'),d=constraint.data;
      if(constraint.type!=='category'&&!stockScope.size)continue;
      if(!['resource','category'].includes(constraint.type)){
       if(['stock-transfer','asset-transfer'].includes(constraint.type)){
        const value=constraint.type==='asset-transfer'?(await fact('inventory')).data:d;
        if(!stockScope.has(value.fromProjectId)&&!stockScope.has(value.toProjectId))continue;
       }else{
        const refs=await fact('references'),parent=refs.ownerId&&await c.member(refs.ownerId),owner=parent?(await c.references(parent)).projectId:refs.projectId;
        if(!stockScope.has(owner??null))continue;
       }
      }
     }
    }else if(moduleId||projectId||scope){
     const refs=await fact('references'),parent=refs.ownerId&&await c.member(refs.ownerId),owner=parent?(await c.references(parent)).projectId:refs.projectId;
     if(moduleId&&!projectUsesTool(c.book,owner,moduleId)||scope&&!scope.has(owner??null)||!inScope(c.book,owner,projectId,recursive))continue;
    }
    if(reference){
     const refs=await fact('references');let linked=refs.links.some(r=>namespaces.has(r.workspaceId)&&r.type===reference.type&&r.id===reference.id);
     if(!linked&&reference.type==='resource'&&reference.workspaceId===workspaceId){const constraint=await fact('constraint');linked=constraint.data.resourceId===reference.id||constraint.type==='bom'&&constraint.data.lines.some(line=>line.resourceId===reference.id);}
     if(!linked)continue;
     if(['task','booking','calendar','event','subscription','calendar-connection'].includes(member.type)){
      const parent=refs.ownerId&&await c.member(refs.ownerId),owner=parent?(await c.references(parent)).projectId:refs.projectId;
      if(!projectUsesTool(c.book,owner,'planning'))continue;
     }
    }
    const view=selectedView??await c.view(member);if(type&&view.type!==type||types&&!types.includes(view.type)||status&&view.status!==status)continue;
    if(tags.length&&!matchesResourceTags(view.tags,tags,tagMode))continue;
    if(needle&&!(await c.search(member)).includes(needle))continue;
    if(!keys&&inStockScope&&view.type==='resource'&&!await inStockScope(await fact('constraint')))continue;
    yield view;
   }
}
