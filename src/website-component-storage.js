import {randomUUID} from 'node:crypto';
import {AppError} from './errors.js';
import {affectedComponents,checkComponentSchema,checkInstanceOptions,componentDependencies,componentUseCounts,migrateInstance} from './website-component-schema.js';
import {componentImpact} from './website-component-impact.js';
import {componentCSS} from './website-component-styles.js';
import {validateWebsiteHTML} from './website-file-policy.js';
import {websiteRecordingKind} from './website-recordings.js';
import {checkComponentInstances,componentTemplate,insertComponent,makeFirstInstance,pageComponentDocument,prepareComponent,rewriteComponentInstances,selectComponentBlock,wrapComponentEntry} from './website-file-component.js';

const fail=()=>{throw new AppError('INVALID');};
const revision=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const list=manifest=>manifest.components??[];
const map=(rows,key)=>new Map(rows.map(row=>[row[key],row]));
const componentName=value=>typeof value==='string'&&value.trim().length>0&&value.length<=100?value.trim():fail();
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
export function checkComponentManifest(manifest,files){
 if(manifest.components===undefined&&!manifest.pages.some(p=>p.instances?.length))return;
 const bad=()=>{throw new AppError('FORMAT');},entries=list(manifest);
 if(!Array.isArray(entries))bad();
 const ids=new Set(),placements=new Set();
 for(const main of entries){
  if(!uuid(main?.id)||ids.has(main.id)||typeof main.name!=='string'||!main.name.trim()||main.name.length>100||typeof main.html!=='string'||Buffer.byteLength(main.html)>64*1024||!Array.isArray(main.pictures))bad();
  ids.add(main.id);
  if(main.slots||main.variants)checkComponentSchema(main);
  if(main.recordings!==undefined&&(!Array.isArray(main.recordings)||main.recordings.some(f=>!websiteRecordingKind(f))))bad();
  for(const descriptor of [...main.pictures,...(main.recordings??[])]){
   const file=files.get(descriptor.name);
   if(!file||file.sourceId||file.picture!==descriptor.picture||file.recording!==descriptor.recording||file.contentType!==descriptor.contentType||file.blob!==descriptor.blob||file.sha256!==descriptor.sha256||file.size!==descriptor.size||file.draft!==descriptor.draft||file.draft&&!main.draft)bad();
  }
 }
 const designed=entries.some(c=>c.slots?.length||c.variants?.length),components=designed?map(entries,'id'):null;
 if(designed)componentDependencies(components);
 for(const page of manifest.pages){
  let sources;
  for(const row of page.instances??[]){
   if(!uuid(row.id)||placements.has(row.id)||!ids.has(row.component))bad();
   placements.add(row.id);
   if(row.values||row.variant||row.entries)checkInstanceOptions(components?.get(row.component)??{},row,files,page.draft);
   if(row.entries){
    sources??=new Set(page.placements.map(p=>p.id));
    if(Object.values(row.entries).some(id=>!sources.has(id)))bad();
   }
  }
 }
}
export function componentContext(manifest){
 const components=map(list(manifest),'id'),pages=map(manifest.pages,'path'),files=map(manifest.files,'name');
 const themes=new Set(manifest.themeBook?.items.map(theme=>theme.id)??[]);
 return {components,pages,files,themes};
}
export function retainComponentAssets(manifest){
 if(!manifest.components?.length)return manifest;
 const files=map(manifest.files,'name');
 // The public file/export boundary checks live page and stylesheet references.
 // A private master can still use a picture, recording or caption after its
 // last placement was detached and removed from a page.
 for(const main of manifest.components)for(const asset of [...main.pictures,...(main.recordings??[])]){
  const existing=files.get(asset.name);
  if(existing&&(existing.blob!==asset.blob||existing.picture!==asset.picture||existing.recording!==asset.recording||existing.sourceId))fail();
  files.set(asset.name,asset);
 }
 checkComponentManifest(manifest,files);
 return {...manifest,files:[...files.values()]};
}
export function checkSavedComponents(manifest,page,html){
 if(page?.instances?.length||/data-website-instance/i.test(html))checkComponentInstances(html,page??{},componentContext(manifest));
}
export function componentOperation(store,operation,id,options={},requireReview=false){
 const {expectedRevision,path='index.html',name,instance,html,position,blockPath,query='',offset=0,signal}=options;let {component}=options;
 if(!revision(expectedRevision))fail();
 const write=['create','insert','wrap','update','detach','remove','customize'].includes(operation);
 if(!write&&!['list','main','usage','review','instance','choices'].includes(operation))fail();
 return store.scope(async()=>{
  const manifest=await store.current(id,expectedRevision),page=manifest.pages.find(row=>row.path===path);
  if(!page)throw new AppError('NOT_FOUND');
  if(operation==='list'){
   if(typeof query!=='string'||query.length>100||!Number.isSafeInteger(offset)||offset<0)fail();
   const term=query.trim().toLowerCase(),items=[];let total=0;
   for(const item of list(manifest)){
    if(item.draft&&!page.draft||!item.name.toLowerCase().includes(term))continue;
    if(total>=offset&&items.length<12)items.push({id:item.id,name:item.name,instances:0,pages:0,draft:Boolean(item.draft),editable:!page.draft||Boolean(item.draft),removable:!page.draft||Boolean(item.draft),entryFields:(item.slots??[]).filter(s=>s.type==='entry').map(s=>({id:s.id,name:s.name}))});total++;
   }
   const shown=map(items,'id'),components=map(list(manifest),'id');
   for(const main of components.values())for(const slot of main.slots??[])if(slot.type==='component'&&shown.has(slot.component))shown.get(slot.component).removable=false;
   for(const owner of manifest.pages){
    for(const [key,count] of componentUseCounts(components,owner.instances??[])){
     const item=shown.get(key);if(!item)continue;
     item.removable=false;if(owner.draft&&!page.draft)continue;
     item.instances+=count;item.pages++;
    }
   }
   return {revision:expectedRevision,items,total,next:offset+12<total?offset+12:null};
  }
  const placed=instance&&page.instances?.find(row=>row.id===instance);
  if(['main','instance','customize'].includes(operation)&&component===undefined)component=placed?.component;
  const context=componentContext(manifest),main=context.components.get(component),visible=main&&(!main.draft||page.draft);
  if(operation==='choices'){
   if(typeof query!=='string'||query.length>100||!Number.isSafeInteger(offset)||offset<0)fail();
   if(component!==undefined&&!visible)throw new AppError('NOT_FOUND');
   const type=options.type,term=query.trim().toLowerCase(),items=[];let total=0;
   const add=(id,name)=>{if(!name.toLowerCase().includes(term))return;if(total>=offset&&items.length<24)items.push({id,name});total++;};
   if(type==='image'){
    for(const f of context.files.values())if(f.picture&&!f.sourceId&&!f.feedAsset&&(!f.draft||page.draft))add(f.name,f.name);
   }else if(type==='component'){
    for(const c of context.components.values())if(c.id!==component&&(!c.draft||main?.draft||!main&&page.draft))add(c.id,c.name);
   }else if(type==='style'){
    for(const style of manifest.styleBook?.tokens??[])add(style.classId,style.name);
   }else fail();
   return {revision:expectedRevision,items,total,next:offset+24<total?offset+24:null};
  }
  if(operation==='instance'){
   if(!placed||!visible||placed.component!==component)throw new AppError('NOT_FOUND');
   return {revision:expectedRevision,id:placed.id,name:main.name,component,values:placed.values??{},variant:placed.variant??null,slots:main.slots??[],variants:main.variants??[]};
  }
  if(operation==='usage'){
   if(!visible)throw new AppError('NOT_FOUND');if(!Number.isSafeInteger(offset)||offset<0)fail();
   const related=affectedComponents(componentDependencies(context.components),component);
   const items=[];let total=0;
   for(const owner of manifest.pages){
    if(owner.draft&&!page.draft)continue;
    for(const row of owner.instances??[])if(related.has(row.component)){
     if(total>=offset&&items.length<12)items.push({instance:row.id,path:owner.path,title:owner.title});
     total++;
    }
   }
   return {revision:expectedRevision,items,total,next:offset+12<total?offset+12:null};
  }
  if(operation==='main'){
   if(!visible)throw new AppError('NOT_FOUND');
   return {revision:expectedRevision,id:main.id,name:main.name,html:main.html,slots:main.slots??[],variants:main.variants??[],css:main.css??'',editable:!page.draft||Boolean(main.draft)};
  }
  if(operation==='remove'){
   if(!visible)throw new AppError('NOT_FOUND');
   if(page.draft&&!main.draft)throw new AppError('WEBSITE_PUBLIC_COMPONENT');
   if(manifest.pages.some(owner=>owner.instances?.some(row=>row.component===component))||list(manifest).some(c=>c.slots?.some(s=>s.component===component)))fail();
   const components=list(manifest).filter(row=>row.id!==component),kept=new Set([...manifest.pages.flatMap(p=>[...(p.pictures??[]),...(p.recordings??[])]),...Object.values(manifest.pictureStyles??{}).flat()]);
   const files=manifest.files.filter(file=>!file.picture&&!file.recording||kept.has(file.name));
   const candidate={...manifest,components,files};await store.assertSources(candidate);
   return store.present(await store.commit(candidate,{signal}),path,{signal});
  }
  if(operation==='detach'&&!page.instances?.some(i=>i.id===instance))fail();
  const current=operation==='detach'?context.components.get(page.instances.find(i=>i.id===instance).component):operation==='create'?null:main;
  if(operation!=='create'&&(!current||current.draft&&!page.draft))throw new AppError('NOT_FOUND');
  if(['update','review'].includes(operation)&&page.draft&&!current.draft)throw new AppError('WEBSITE_PUBLIC_COMPONENT');
  let proposed,impact;
  if(operation==='update'||operation==='review'){
   if(typeof html!=='string'||Buffer.byteLength(html)>64*1024)fail();
   proposed={...current,html,name:componentName(name),slots:options.slots??current.slots??[],variants:options.variants??current.variants??[],css:options.css??current.css??''};
   proposed.css=componentCSS(proposed.css,html,manifest.breakpoints);
   impact=componentImpact(manifest,page,current,proposed,options);
   if(operation==='review'){componentTemplate(html,proposed);return impact.review;}
   if((requireReview||options.reviewId!==undefined)&&impact.review.reviewId!==options.reviewId)throw new AppError('CONFLICT');
  }
  if(operation==='customize'&&(!placed||placed.component!==component))throw new AppError('NOT_FOUND');
  const sourceFile=context.files.get(path),sourceHTML=await store.readText(sourceFile,{signal}),document=pageComponentDocument(sourceHTML);
  let definition=current,first;
  if(operation==='create'||operation==='update'){
   const creating=operation==='create',label=componentName(name);
   if(list(manifest).some(item=>item.id!==current?.id&&item.name.toLowerCase()===label.toLowerCase()))fail();
   // On creation the server selects the actual saved subtree, never a client
   // fragment. Main edits are expressed in portable, site-root coordinates.
   const content=creating?selectComponentBlock(document,blockPath):html;
   const prepared=prepareComponent(content,creating?path:'index.html',{...context,draft:creating?page.draft:current.draft},proposed);
   definition={id:creating?randomUUID():current.id,name:label,...prepared,...((creating?page.draft:current.draft)?{draft:true}:{})};
   if(proposed?.slots.length)definition.slots=proposed.slots;
   if(proposed?.variants.length)definition.variants=proposed.variants;
   if(proposed?.css)definition.css=proposed.css;
   if(current?.inclusionOwned)definition.inclusionOwned=true;
   context.components.set(definition.id,definition);
  }
  if(['insert','create','wrap'].includes(operation))first={id:randomUUID(),component:definition.id,...(operation==='create'?{originalIds:true}:{})};
  const scripts=await store.scripts(manifest.files),files=map(manifest.files,'name'),pages=[];
  const priorBlobs=new Set(manifest.files.map(file=>file.blob)),staged=new Set();
  try{
  for(const prior of manifest.pages){
   signal?.throwIfAborted();
   const applies=operation==='update'?prior.instances?.some(i=>impact.affected.has(i.component)):prior.path===path;
   if(!applies){pages.push(prior);continue;}
   const text=prior.path===path?sourceHTML:await store.readText(files.get(prior.path),{signal}),doc=prior.path===path?document:pageComponentDocument(text);
   // Check the old shape before allowing any propagation, including on pages
   // other than the one where the author opened the editor.
   checkComponentInstances(text,prior,{...context,components:map(list(manifest),'id')});
   let instances=prior.instances??[],next;
   if(operation==='create')next=makeFirstInstance(text,doc,blockPath,definition,first,prior,context);
   if(operation==='insert')next=insertComponent(text,doc,position,blockPath,definition,first,prior,context);
   if(operation==='wrap')next=wrapComponentEntry(text,doc,blockPath,definition,first,prior,context,options);
   if(first)instances=[...instances,first];
   if(operation==='update'||operation==='detach'||operation==='customize'){
    if(operation==='update')instances=instances.map(row=>row.component===definition.id?migrateInstance(row,current,definition):row);
    if(operation==='customize')instances=instances.map(row=>{
     if(row.id!==instance)return row;
     const updated={...row,values:options.values??{}};if(options.variant)updated.variant=options.variant;else delete updated.variant;
     checkInstanceOptions(definition,updated,context.files,prior.draft);return updated;
    });
    next=rewriteComponentInstances(text,doc,definition,{...prior,instances},context,{affected:impact?.affected,only:operation==='customize'?instance:null,detach:operation==='detach'?instance:null});
    if(operation==='detach')instances=instances.filter(row=>row.id!==instance);
   }
   const pictures=new Set(),recordings=new Set();validateWebsiteHTML(next,{file:prior.path,scripts,pictures,recordings});
   const changed={...prior,instances,pictures:[...pictures],recordings:[...recordings]};
   checkComponentInstances(next,changed,context);
   for(const name of [...pictures,...recordings]){
    const file=context.files.get(name);if(!file||file.draft&&!prior.draft)fail();
    files.set(name,file);
   }
   const descriptor=await store.siteFile(id,prior.path,next,{draft:prior.draft,signal});
   if(!priorBlobs.has(descriptor.blob))staged.add(descriptor.blob);
   files.set(prior.path,descriptor);pages.push(changed);
  }
  const used=new Set([...pages.flatMap(p=>[...(p.pictures??[]),...(p.recordings??[])]),...Object.values(manifest.pictureStyles??{}).flat()]);
  const candidate={...manifest,components:[...context.components.values()],pages,files:[...files.values()].filter(f=>(!f.picture&&!f.recording)||used.has(f.name))};
  await store.assertSources(candidate);
  return await store.present(await store.commit(candidate,{signal}),path,{signal});
  }catch(error){
   if(staged.size&&(await store.raw(id)).revision===expectedRevision)for(const blob of staged)await store.discardStaged(blob);
   throw error;
  }
 },{write,signal});
}
