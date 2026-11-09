import {AppError} from './errors.js';
import {digest} from './storage-format.js';
import {affectedComponents,checkComponentSchema,componentDependencies,componentUseCounts,migrateInstance} from './website-component-schema.js';

export function componentImpact(manifest,page,main,proposed,options){
 checkComponentSchema(proposed);
 const components=new Map(manifest.components.map(c=>[c.id,c]));components.set(main.id,proposed);
 const affected=affectedComponents(componentDependencies(components),main.id);
 const styles=new Set(manifest.styleBook?.tokens.map(t=>t.classId));
 const previous=new Set(main.variants?.map(v=>v.style));
 for(const variant of proposed.variants??[])if(!styles.has(variant.style)&&!previous.has(variant.style))throw new AppError('INVALID');
 const rows=[],slots=[],before=new Map(main.slots?.map(s=>[s.id,s])),after=new Map(proposed.slots?.map(s=>[s.id,s]));
 for(const id of new Set([...before.keys(),...after.keys()])){
  const a=before.get(id),b=after.get(id);
  if(a?.type!==b?.type||a?.name!==b?.name||a?.component!==b?.component)slots.push({before:a?.name??'',after:b?.name??'',type:b?.type??a?.type});
 }
 let pages=0,instances=0,removedOverrides=0;
 for(const owner of manifest.pages){
  const shown=!owner.draft||page.draft;
  let count=0;
  for(const row of owner.instances??[])if(affected.has(row.component)){
   count++;if(row.component!==main.id||!row.values&&!row.variant&&!row.entries)continue;
   const next=migrateInstance(row,main,proposed);
   if(shown)removedOverrides+=Object.keys(row.values??{}).length-Object.keys(next.values??{}).length+Number(Boolean(row.variant&&!next.variant));
  }
  if(shown&&count){
   if(affected.size>1)count=componentUseCounts(components,owner.instances).get(main.id);
   pages++;instances+=count;if(rows.length<32)rows.push({path:owner.path,title:owner.title,count});
  }
 }
 // Named immutable intent, including the full submitted main and styles.
 const reviewId=digest(JSON.stringify(['component-update',manifest.id,manifest.revision,page.path,main.id,options.name,options.html,proposed.slots??[],proposed.variants??[],proposed.css??'']));
 return {affected,review:{reviewId,pages,instances,removedOverrides,rows,slots}};
}
