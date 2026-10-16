import {AppError} from './errors.js';
import {ProjectModuleQueries} from './project-module-queries.js';
import {inventoryQuantities} from './modules/inventory-query.js';
import {exact,uuid} from './modules/validation.js';
const validReference=value=>exact(value,['workspaceId','type','id'])&&uuid(value.workspaceId)&&value.type==='resource'&&uuid(value.id);

// A selected source supplies stock and placement facts in one snapshot. Only
// bounded requested resources and placement labels leave that owner.
export async function inventorySourceQuery(storage,workspaceId,data,{sourceAccess,check=async()=>{},signal}={}){
 if(!data||typeof data!=='object'||Array.isArray(data))throw new AppError('INVALID');
 const bulk=Object.hasOwn(data,'references'),references=bulk?data.references:[data.reference],scopeIds=data.scopeIds??[null],offset=data.placementOffset??0;
 const keys=['workspaceId',bulk?'references':'reference',...['scopeIds','placementOffset'].filter(key=>Object.hasOwn(data,key))];
 if(!exact(data,keys)||data.workspaceId!==workspaceId||!Array.isArray(references)||!references.length||references.length>25||!references.every(validReference)||new Set(references.map(ref=>ref.workspaceId)).size!==1||new Set(references.map(ref=>ref.id)).size!==references.length||!Array.isArray(scopeIds)||scopeIds.length>25||!scopeIds.length||!scopeIds.every(id=>id===null||uuid(id))||new Set(scopeIds).size!==scopeIds.length||!Number.isSafeInteger(offset)||offset<0)throw new AppError('INVALID');
 if(typeof sourceAccess!=='function')throw new AppError('ACCESS_UPGRADE');await check();signal?.throwIfAborted();
 const access=await sourceAccess(workspaceId,{signal});
 try{
  const items=await access.useOwner(references[0].workspaceId,async(source,owner)=>new ProjectModuleQueries(source,owner.workspaceId).context('inventory','resource',async context=>{
   const placements=[{id:null,title:context.book.title},...context.book.projects.map(project=>({id:project.id,title:project.title}))];
   if(offset>=placements.length&&offset!==0)throw new AppError('INVALID');
   const selectedPlacements=scopeIds.map(id=>{const location=placements.find(item=>item.id===id);if(!location)throw new AppError('MODULE_REFERENCE');return location;});
   const quantities=await inventoryQuantities(context,references.map(ref=>ref.id),{signal,scope:new Set(scopeIds)}),result=[];
   for(const reference of references){
    const value=quantities.get(reference.id);if(value.data.kind!=='material')throw new AppError('MODULE_REFERENCE');
    const resource={id:reference.id,revision:value.revision,data:Object.fromEntries(['name','kind','unit','status','projectId'].map(key=>[key,value.data[key]??null]))};
    const locations=selectedPlacements.map(location=>({...value.locations.find(row=>row.projectId===location.id)??{projectId:location.id,physical:'0',reserved:'0',available:'0',used:'0',scrapped:'0',builds:0},label:location.title}));
    result.push({reference,owner,resource,placements:placements.slice(offset,offset+25),selectedPlacements,placementNextOffset:offset+25<placements.length?offset+25:null,placementTotal:placements.length,stock:{...value,data:resource.data,locations},revisions:context.revisions});
   }
   return result;
  },{signal}));
  await access.verify();await check();return bulk?{workspaceId,items}:{workspaceId,...items[0]};
 }finally{await access.close();}
}
