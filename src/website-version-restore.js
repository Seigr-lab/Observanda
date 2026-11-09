import {AppError} from './errors.js';
import {digest} from './storage-format.js';
import {websiteFileReferences} from './website-page-dependencies.js';
import {addPageStyle,newPageStylesheet,pageStylesheet,switchBaseStyle} from './website-page-style.js';
import {componentContext} from './website-component-storage.js';
import {pageComponentDocument,rewriteComponentInstances} from './website-file-component.js';
import {versionOwner} from './website-version-snapshots.js';
import {versionContext,versionPage} from './website-versions.js';

const unavailable=()=>{throw new AppError('CONFLICT');};
const managed=file=>file?.sourceId||file?.feedAsset||file?.feedPage;
// Follow the selected document's saved, local dependency graph. A private
// owner's bytes can never replace an included resource during restoration.
async function dependencies(store,ctx,page,html,sheet,css,draft,signal){
 const queue=[...websiteFileReferences(html,page),...websiteFileReferences(css,sheet)].map(ref=>ref.name);
 const seen=new Set([page,sheet]),resources=[],blocked=[];
 for(let i=0;i<queue.length;i++){
  signal?.throwIfAborted();
  const name=queue[i];
  if(seen.has(name)||name.endsWith('.html'))continue;seen.add(name);
  const now=ctx.files.get(name),archived=ctx.assets.get(name);
  if(managed(now)||!archived)continue;
  if(archived.draft&&!draft||now?.draft&&!draft||archived.draft&&now&&!now.draft){blocked.push({name,reason:'private'});continue;}
  if(!ctx.held.has(archived.blob)){blocked.push({name,reason:'unavailable'});continue;}
  if(name.endsWith('.css')){
   const text=await store.readText(archived,{signal});
   for(const ref of websiteFileReferences(text,name))queue.push(ref.name);
  }
  if(now?.sha256!==archived.sha256)resources.push(archived);
 }
 return {resources,blocked};
}
function restoreInstances(context,row,path,draft){
 const instances=row.former.instances??[],model=componentContext(context.current),page={path,draft,instances};
 const used=new Set(context.current.pages.filter(p=>p.path!==path).flatMap(p=>(p.instances??[]).map(i=>i.id)));
 if(instances.some(i=>used.has(i.id)))return null;
 let html=row.html;
 for(const id of new Set(instances.map(i=>i.component))){
  const main=model.components.get(id);if(!main||main.draft&&!draft)return null;
  try{html=rewriteComponentInstances(html,pageComponentDocument(html),main,page,model);}
  catch(e){if(e.code==='INVALID'||e.code==='CONFLICT')return null;throw e;}
 }
 return html;
}
export function restoreWebsitePageVersion(store,id,options,apply=false){
 const {expectedRevision,version,path='index.html',signal,reviewId,offset=0}=options;
 if(!Number.isSafeInteger(offset)||offset<0)throw new AppError('INVALID');
 return store.scope(async()=>{
  const ctx=await versionContext(store,id,expectedRevision,version),row=await versionPage(store,ctx,path,signal);
  const {current,files}=ctx,draft=!row.owner||!!row.owner.draft;
  const oldStyle=pageStylesheet(ctx.saved.settings,row.former),desired=ctx.assets.get(oldStyle);
  let status=row.status,css='',html=row.html;
  if(status==='ready'){
   if(!desired||!ctx.held.has(desired.blob))status='unavailable';
   else if(desired.draft&&!draft)status='private';
   else if(!row.owner&&current.files.some(f=>f.name.toLowerCase()===path.toLowerCase()))status='occupied';
   else{
    css=await store.readText(desired,{signal});
    html=restoreInstances(ctx,row,path,draft);
    if(html===null)status='components';
   }
  }
  const assets=status==='ready'?await dependencies(store,ctx,path,html,oldStyle,css,draft,signal):{resources:[],blocked:[]};
  if(assets.blocked.length)status='resources';
  const names=assets.resources.map(f=>({name:f.name,reason:'restore'})).concat(assets.blocked);
  const style=row.owner&&pageStylesheet(current,row.owner);
  const shared=style&&files.get(style)?.sha256!==desired?.sha256?current.pages.filter(p=>p.path!==path&&pageStylesheet(current,p)===style).map(p=>p.path):[];
  const review={revision:expectedRevision,version,path,status,draft,createsPage:!row.owner,
   unavailable:row.unavailable??0,updated:row.updated??0,currentOnly:row.currentOnly??0};
  const token=digest(JSON.stringify([review,names,shared]));
  await store.current(id,expectedRevision);
  if(!apply){
   const changes=[...(row.sections??[]),...names,...shared.map(name=>({name,reason:'sharedStyle'}))];
   return {...review,reviewId:token,items:changes.slice(offset,offset+40),total:changes.length,next:offset+40<changes.length?offset+40:null};
  }
  if(reviewId!==token||status!=='ready')unavailable();
  const stylePath=style??newPageStylesheet(current);
  if(!row.owner&&oldStyle===current.cssPath)html=addPageStyle(html,path,stylePath);
  else if(oldStyle!==stylePath)html=addPageStyle(switchBaseStyle(html,path,oldStyle,stylePath),path,stylePath);
  const resources=[];
  for(const historical of assets.resources){
   const now=files.get(historical.name),privateFile=now?!!now.draft:draft||!!historical.draft;
   if(historical.blob.startsWith(versionOwner(id)+'/')){
    const clean=await store.readText(historical,{signal});
    resources.push(await store.siteFile(id,historical.name,clean,{draft:privateFile,signal}));
   }else resources.push(await store.ownFile(id,historical,privateFile,signal));
  }
  const instances=row.former.instances??[];
  return store.save(id,{expectedRevision,path,html,css,signal},row.owner?undefined:instances,
   row.owner?undefined:{stylePath,draft:true},{version,resources,instances});
 },{write:apply,signal});
}
