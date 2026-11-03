import {randomUUID} from 'node:crypto';
import {AppError} from './errors.js';
import {validateWebsiteHTML} from './website-file-policy.js';
import {websiteRecordingKind} from './website-recordings.js';
import {checkComponentInstances,insertComponent,makeFirstInstance,pageComponentDocument,prepareComponent,rewriteComponentInstances,selectComponentBlock} from './website-file-component.js';

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
  if(main.recordings!==undefined&&(!Array.isArray(main.recordings)||main.recordings.some(f=>!websiteRecordingKind(f))))bad();
  for(const descriptor of [...main.pictures,...(main.recordings??[])]){
   const file=files.get(descriptor.name);
   if(!file||file.sourceId||file.picture!==descriptor.picture||file.recording!==descriptor.recording||file.contentType!==descriptor.contentType||file.blob!==descriptor.blob||file.sha256!==descriptor.sha256||file.size!==descriptor.size||file.draft!==descriptor.draft||file.draft&&!main.draft)bad();
  }
 }
 for(const page of manifest.pages)for(const row of page.instances??[]){
  if(!uuid(row.id)||placements.has(row.id)||!ids.has(row.component))bad();
  placements.add(row.id);
 }
}
function contextOf(manifest){
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
 if(page?.instances?.length||/data-website-instance/i.test(html))checkComponentInstances(html,page??{},contextOf(manifest));
}
export function componentOperation(store,operation,id,{expectedRevision,path='index.html',name,component,instance,html,position,blockPath,query='',offset=0,signal}={}){
 if(!revision(expectedRevision))fail();
 const write=['create','insert','update','detach','remove'].includes(operation);
 if(!write&&!['list','main','usage'].includes(operation))fail();
 return store.scope(async()=>{
  const manifest=await store.current(id,expectedRevision),page=manifest.pages.find(row=>row.path===path);
  if(!page)throw new AppError('NOT_FOUND');
  if(operation==='list'){
   if(typeof query!=='string'||query.length>100||!Number.isSafeInteger(offset)||offset<0)fail();
   const term=query.trim().toLowerCase(),items=[];let total=0;
   for(const item of list(manifest)){
    if(item.draft&&!page.draft||!item.name.toLowerCase().includes(term))continue;
    if(total>=offset&&items.length<12)items.push({id:item.id,name:item.name,instances:0,pages:0,draft:Boolean(item.draft),removable:true});total++;
   }
   const shown=map(items,'id');
   for(const owner of manifest.pages){
    const counted=new Set();
    for(const placed of owner.instances??[]){
     const item=shown.get(placed.component);if(!item)continue;
     item.removable=false;if(owner.draft&&!page.draft)continue;
     item.instances++;if(!counted.has(item.id)){counted.add(item.id);item.pages++;}
    }
   }
   return {revision:expectedRevision,items,total,next:offset+12<total?offset+12:null};
  }
  const context=contextOf(manifest),main=context.components.get(component),visible=main&&(!main.draft||page.draft);
  if(operation==='usage'){
   if(!visible)throw new AppError('NOT_FOUND');if(!Number.isSafeInteger(offset)||offset<0)fail();
   const items=[];let total=0;
   for(const owner of manifest.pages){
    if(owner.draft&&!page.draft)continue;
    for(const row of owner.instances??[])if(row.component===component){
     if(total>=offset&&items.length<12)items.push({instance:row.id,path:owner.path,title:owner.title});
     total++;
    }
   }
   return {revision:expectedRevision,items,total,next:offset+12<total?offset+12:null};
  }
  if(operation==='main'){
   if(!visible)throw new AppError('NOT_FOUND');
   return {revision:expectedRevision,id:main.id,name:main.name,html:main.html};
  }
  if(operation==='remove'){
   if(!visible)throw new AppError('NOT_FOUND');
   if(manifest.pages.some(owner=>owner.instances?.some(row=>row.component===component)))fail();
   const components=list(manifest).filter(row=>row.id!==component),kept=new Set([...manifest.pages.flatMap(p=>[...(p.pictures??[]),...(p.recordings??[])]),...Object.values(manifest.pictureStyles??{}).flat()]);
   const files=manifest.files.filter(file=>!file.picture&&!file.recording||kept.has(file.name));
   const candidate={...manifest,components,files};await store.assertSources(candidate);
   return store.present(await store.commit(candidate,{signal}),path,{signal});
  }
  if(operation==='detach'&&!page.instances?.some(i=>i.id===instance))fail();
  const current=operation==='detach'?context.components.get(page.instances.find(i=>i.id===instance).component):operation==='create'?null:main;
  if(operation!=='create'&&(!current||current.draft&&!page.draft))throw new AppError('NOT_FOUND');
  const sourceFile=context.files.get(path),sourceHTML=await store.readText(sourceFile,{signal}),document=pageComponentDocument(sourceHTML);
  let definition=current,first;
  if(operation==='create'||operation==='update'){
   const creating=operation==='create',label=componentName(name);
   if(list(manifest).some(item=>item.id!==current?.id&&item.name.toLowerCase()===label.toLowerCase()))fail();
   // On creation the server selects the actual saved subtree, never a client
   // fragment. Main edits are expressed in portable, site-root coordinates.
   const content=creating?selectComponentBlock(document,blockPath):html;
   const prepared=prepareComponent(content,creating?path:'index.html',{...context,draft:creating?page.draft:current.draft});
   definition={id:creating?randomUUID():current.id,name:label,...prepared,...((creating?page.draft:current.draft)?{draft:true}:{})};
   context.components.set(definition.id,definition);
  }
  if(operation==='insert'||operation==='create')first={id:randomUUID(),component:definition.id,...(operation==='create'?{originalIds:true}:{})};
  const scripts=await store.scripts(manifest.files),files=map(manifest.files,'name'),pages=[];
  const priorBlobs=new Set(manifest.files.map(file=>file.blob)),staged=new Set();
  try{
  for(const prior of manifest.pages){
   signal?.throwIfAborted();
   const applies=operation==='update'?prior.instances?.some(i=>i.component===definition.id):prior.path===path;
   if(!applies){pages.push(prior);continue;}
   const text=prior.path===path?sourceHTML:await store.readText(files.get(prior.path),{signal}),doc=prior.path===path?document:pageComponentDocument(text);
   // Check the old shape before allowing any propagation, including on pages
   // other than the one where the author opened the editor.
   checkComponentInstances(text,prior,{...context,components:map(list(manifest),'id')});
   let instances=prior.instances??[],next;
   if(operation==='create')next=makeFirstInstance(text,doc,blockPath,definition,first,prior,context);
   if(operation==='insert')next=insertComponent(text,doc,position,blockPath,definition,first,prior,context);
   if(first)instances=[...instances,first];
   if(operation==='update'||operation==='detach'){
    next=rewriteComponentInstances(text,doc,definition,prior,context,{detach:operation==='detach'?instance:null});
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
   if(staged.size&&(await store.raw(id)).revision===expectedRevision)for(const blob of staged)await store.remove(blob);
   throw error;
  }
 },{write,signal});
}
