import {randomUUID} from 'node:crypto';
import {AppError} from './errors.js';
import {validateWebsiteHTML} from './website-file-policy.js';
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
 if(!Array.isArray(entries)||entries.length>128)bad();
 const ids=new Set(),placements=new Set();
 for(const main of entries){
  if(!uuid(main?.id)||ids.has(main.id)||typeof main.name!=='string'||!main.name.trim()||main.name.length>100||typeof main.html!=='string'||Buffer.byteLength(main.html)>64*1024||!Array.isArray(main.pictures))bad();
  ids.add(main.id);
  for(const descriptor of main.pictures){
   const file=files.get(descriptor.name);
   if(!file?.picture||file.sourceId||file.blob!==descriptor.blob||file.sha256!==descriptor.sha256||file.size!==descriptor.size||file.draft!==descriptor.draft||file.draft&&!main.draft)bad();
  }
 }
 for(const page of manifest.pages)for(const row of page.instances??[]){
  if(!uuid(row.id)||placements.has(row.id)||!ids.has(row.component))bad();
  placements.add(row.id);
 }
}
function contextOf(manifest){
 const components=map(list(manifest),'id'),pages=map(manifest.pages,'path'),files=map(manifest.files,'name');
 return {components,pages,files};
}
export function retainComponentPictures(manifest){
 if(!manifest.components?.length)return manifest;
 const files=map(manifest.files,'name');
 // The public file/export boundary checks live page and stylesheet references.
 // Keep the private master’s image bytes available after its last placed use.
 for(const main of manifest.components)for(const picture of main.pictures){
  const existing=files.get(picture.name);
  if(existing&&(existing.blob!==picture.blob||existing.picture!==true||existing.sourceId))fail();
  files.set(picture.name,picture);
 }
 checkComponentManifest(manifest,files);
 return {...manifest,files:[...files.values()]};
}
export function checkSavedComponents(manifest,page,html){
 if(page?.instances?.length||/data-website-instance/i.test(html))checkComponentInstances(html,page??{},contextOf(manifest));
}
export function componentOperation(store,operation,id,{expectedRevision,path='index.html',name,component,instance,html,position,blockPath,query='',offset=0,signal}={}){
 if(!revision(expectedRevision))fail();
 const write=['create','insert','update','detach'].includes(operation);
 if(!write&&!['list','main'].includes(operation))fail();
 return store.scope(async()=>{
  const manifest=await store.current(id,expectedRevision),context=contextOf(manifest),page=context.pages.get(path);
  if(!page)throw new AppError('NOT_FOUND');
  const main=context.components.get(component),visible=main&&(!main.draft||page.draft);
  if(operation==='list'){
   if(typeof query!=='string'||query.length>100||!Number.isSafeInteger(offset)||offset<0)fail();
   const rows=list(manifest).filter(item=>(!item.draft||page.draft)&&item.name.toLowerCase().includes(query.trim().toLowerCase()));
   return {revision:expectedRevision,items:rows.slice(offset,offset+12).map(({id,name})=>({id,name})),total:rows.length,next:offset+12<rows.length?offset+12:null};
  }
  if(operation==='main'){
   if(!visible)throw new AppError('NOT_FOUND');
   return {revision:expectedRevision,id:main.id,name:main.name,html:main.html};
  }
  if(operation==='detach'&&!page.instances?.some(i=>i.id===instance))fail();
  const current=operation==='detach'?context.components.get(page.instances.find(i=>i.id===instance).component):operation==='create'?null:main;
  if(operation!=='create'&&(!current||current.draft&&!page.draft))throw new AppError('NOT_FOUND');
  const sourceFile=context.files.get(path),sourceHTML=await store.readText(sourceFile,{signal}),document=pageComponentDocument(sourceHTML);
  let definition=current,first;
  if(operation==='create'||operation==='update'){
   const creating=operation==='create',label=componentName(name);
   if(list(manifest).some(item=>item.id!==current?.id&&item.name.toLowerCase()===label.toLowerCase()))fail();
   if(creating&&context.components.size>=128)throw new AppError('LIMIT');
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
   const pictures=new Set();validateWebsiteHTML(next,{file:prior.path,scripts,pictures});
   const changed={...prior,instances,pictures:[...pictures]};
   checkComponentInstances(next,changed,context);
   for(const name of pictures){
    const file=context.files.get(name);if(!file||file.draft&&!prior.draft)fail();
    files.set(name,file);
   }
   const descriptor=await store.siteFile(id,prior.path,next,{draft:prior.draft,signal});
   if(!priorBlobs.has(descriptor.blob))staged.add(descriptor.blob);
   files.set(prior.path,descriptor);pages.push(changed);
  }
  const used=new Set([...pages.flatMap(p=>p.pictures??[]),...Object.values(manifest.pictureStyles??{}).flat()]);
  const candidate={...manifest,components:[...context.components.values()],pages,files:[...files.values()].filter(f=>!f.picture||used.has(f.name))};
  await store.assertSources(candidate);
  return await store.present(await store.commit(candidate,{signal}),path,{signal});
  }catch(error){
   if(staged.size&&(await store.raw(id)).revision===expectedRevision)for(const blob of staged)await store.remove(blob);
   throw error;
  }
 },{write,signal});
}
