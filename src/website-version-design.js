import {AppError} from './errors.js';
import {digest} from './storage-format.js';
import {componentContext,checkSavedComponents} from './website-component-storage.js';
import {pageComponentDocument,prepareComponent,rewriteComponentInstances} from './website-file-component.js';
import {validateWebsiteHTML} from './website-file-policy.js';
import {versionContext} from './website-versions.js';
import {websitePageIdentity} from './website-page-paths.js';
import {newStyleBook} from './website-style-resources.js';

const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function value(manifest,kind){
 if(kind==='themeBook')return manifest.themeBook??{items:[],pages:{},folders:{}};
 if(kind==='styleBook'){const {fonts,...styles}=manifest.styleBook??newStyleBook();return styles;}
 if(kind==='pageDesigns')return manifest.pageDesigns??[];
 if(kind==='appearance')return manifest.appearance??null;
 throw new AppError('INVALID');
}
function changeRows(kind,from,to){
 if(kind==='styleBook'){
  const rows=[];
  for(const section of ['tokens','site','pages','folders']){
   const entries=config=>section==='tokens'?Object.fromEntries(config.tokens.map(t=>[t.id,t])):section==='site'?{site:config.site}:config[section];
   const a=entries(from),b=entries(to);
   for(const key of new Set([...Object.keys(a),...Object.keys(b)]))if(!same(a[key],b[key]))rows.push({name:b[key]?.name??a[key]?.name??key,before:JSON.stringify(a[key]??''),after:JSON.stringify(b[key]??'')});
  }
  return rows;
 }
 if(kind==='appearance'){
  const before=from?.values??{},after=to?.values??{};
  return [...new Set([...Object.keys(before),...Object.keys(after)])].flatMap(name=>same(before[name],after[name])?[]:[{name,before:before[name]??'',after:after[name]??''}]);
 }
 const members=list=>new Map(list.map(row=>[row.id,row]));
 const before=members(kind==='themeBook'?from.items:from),after=members(kind==='themeBook'?to.items:to);
 const rows=[...new Set([...before.keys(),...after.keys()])].flatMap(id=>same(before.get(id),after.get(id))?[]:[{
  name:after.get(id)?.name??before.get(id).name,before:before.has(id)?JSON.stringify(before.get(id).values??before.get(id).source):'',after:after.has(id)?JSON.stringify(after.get(id).values??after.get(id).source):''}]);
 if(kind==='themeBook')for(const scope of ['pages','folders'])for(const path of new Set([...Object.keys(from[scope]),...Object.keys(to[scope])])){
  const a=from[scope][path],b=to[scope][path];
  if(a!==b)rows.push({name:path,before:before.get(a)?.name??'',after:after.get(b)?.name??''});
 }
 return rows;
}
async function componentReview(store,ctx,id,signal){
 const former=ctx.saved.settings.components.find(c=>c.id===id);if(!former)throw new AppError('NOT_FOUND');
 const current=ctx.current.components?.find(c=>c.id===id),draft=current?!!current.draft:true;
 let status=former.draft&&!draft?'private':'ready';
 const files=new Map(ctx.files),missing=[];
 for(const name of [...former.pictures,...(former.recordings??[])]){
  const f=ctx.assets.get(name),now=files.get(name);
  if(!f||!ctx.held.has(f.blob)||f.draft&&!draft||now&&(now.draft&&!draft||now.sourceId||now.feedAsset||now.sha256!==f.sha256)){status='resources';missing.push(name);continue;}
  if(!now)files.set(name,f);
 }
 const uses=ctx.current.pages.filter(p=>p.instances?.some(i=>i.component===id));
 const rows=[{name:former.name,before:current?.html??'',after:former.html},...uses.map(p=>({name:p.path,reason:'instance'})),...missing.map(name=>({name,reason:'unavailable'}))];
 const model={...componentContext(ctx.current),files};
 let main;
 if(status==='ready'){
  try{
   const prepared=prepareComponent(former.html,'index.html',{...model,draft});
   main={id,name:former.name,...prepared,...(draft?{draft:true}:{}),...(current?.inclusionOwned?{inclusionOwned:true}:{})};
   if([...model.components.values()].some(item=>item.id!==id&&item.name.toLowerCase()===main.name.toLowerCase()))status='occupied';
  }catch(error){if(error.code==='INVALID'||error.code==='CONFLICT')status='resources';else throw error;}
 }
 return {status,rows,main,uses,model,former,current,draft};
}
async function restoreComponent(store,ctx,review,signal){
 const {main,uses,model,former,draft}=review,id=ctx.current.id;
 const files=model.files;
 for(const name of [...former.pictures,...(former.recordings??[])]){
  if(!ctx.files.has(name))files.set(name,await store.ownFile(id,files.get(name),draft,signal));
 }
 main.pictures=main.pictures.map(f=>files.get(f.name));
 main.recordings=main.recordings.map(f=>files.get(f.name));
 model.components.set(main.id,main);
 const pages=new Map(ctx.current.pages.map(p=>[p.path,p])),scripts=await store.scripts(ctx.current.files);
 for(const page of uses){
  const original=await store.readText(files.get(page.path),{signal});
  checkSavedComponents(ctx.current,page,original);
  const html=rewriteComponentInstances(original,pageComponentDocument(original),main,page,model);
  const pictures=new Set(),recordings=new Set();validateWebsiteHTML(html,{file:page.path,scripts,pictures,recordings});
  pages.set(page.path,{...page,pictures:[...pictures],recordings:[...recordings]});
  files.set(page.path,await store.siteFile(id,page.path,html,{draft:page.draft,signal}));
 }
 return {...ctx.current,pages:[...pages.values()],files:[...files.values()],components:[...model.components.values()]};
}
export function websiteVersionDesign(store,id,options,apply=false){
 const {path='index.html',version,expectedRevision,kind,component,reviewId,offset=0,signal}=options;
 if(!Number.isSafeInteger(offset)||offset<0||!['appearance','themeBook','styleBook','pageDesigns','component'].includes(kind))throw new AppError('INVALID');
 return store.scope(async()=>{
  const ctx=await versionContext(store,id,expectedRevision,version);
  if(!ctx.current.pages.some(p=>p.path===path))throw new AppError('NOT_FOUND');
  let rows,status='ready',desired,definition;
  if(kind==='component'){
   definition=await componentReview(store,ctx,component,signal);({rows,status}=definition);
  }else{
   desired=value(ctx.saved.settings,kind);
   if(kind==='themeBook'||kind==='styleBook'||kind==='pageDesigns'){
    const currentOwners=new Map(ctx.current.pages.map(p=>[websitePageIdentity(id,p),p]));
    const savedOwners=new Map(ctx.saved.pages.map(p=>[p.path,p]));
    const address=original=>{
     const former=savedOwners.get(original),current=former&&currentOwners.get(websitePageIdentity(id,former));
     if(!current){status='unavailable';return original;}
     return current.path;
    };
    if(kind==='themeBook'||kind==='styleBook')desired={...desired,pages:Object.fromEntries(Object.entries(desired.pages).map(([key,theme])=>[address(key),theme]))};
    else desired=desired.map(d=>({...d,source:address(d.source)}));
   }
   rows=changeRows(kind,value(ctx.current,kind),desired);
   if(kind==='styleBook'){
    desired.fonts=ctx.current.styleBook?.fonts??[];
    const fonts=new Set(desired.fonts.map(f=>f.id));
    if(desired.tokens.some(t=>Object.values(t.rules).some(r=>r['font-family']?.startsWith('custom-')&&!fonts.has(r['font-family']))))status='resources';
   }
  }
  const token=digest(JSON.stringify([expectedRevision,version,path,kind,component,status,rows]));
  await store.current(id,expectedRevision);
  if(!apply)return {revision:expectedRevision,version,kind,status,reviewId:token,total:rows.length,items:rows.slice(offset,offset+40),next:offset+40<rows.length?offset+40:null};
  if(status!=='ready'||reviewId!==token)throw new AppError('CONFLICT');
  let next;
  if(kind==='component')next=await restoreComponent(store,ctx,definition,signal);
  else{
   next={...ctx.current,[kind]:desired};
   if(kind==='appearance'&&desired===null)delete next.appearance;
  }
  await store.assertSources(next);
  return store.present(await store.commit(next,{signal,versioning:{restoredFrom:version}}),path,{signal});
 },{write:apply,signal});
}
