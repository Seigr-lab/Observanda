import {AppError} from './errors.js';
import {checkMenuChanges,readWebsiteMenu,writeWebsiteMenu,menuTargetOwner,menuDocument,namedWebsiteMenus} from './website-file-menu.js';
import {researchId} from './web/research-reference.js';
import {operationTotal,operationAdvance} from './operation-progress.js';
import {websiteSourcePlacements} from './website-file-html.js';
import {validateWebsiteHTML} from './website-file-policy.js';

const requireRevision=revision=>{if(typeof revision!=='string'||!/^[a-f0-9]{64}$/.test(revision))throw new AppError('INVALID');};
async function indexDocument(store,manifest,options){
 const file=manifest.files.find(item=>item.name==='index.html'),page=manifest.pages.find(item=>item.path==='index.html');
 return {doc:menuDocument(await store.readText(file,options)),page};
}
export function readSiteMenu(store,id,{expectedRevision,menuId=null,signal}={}){
 return store.scope(async()=>{
  requireRevision(expectedRevision);const manifest=await store.current(id,expectedRevision);
  const {doc,page}=await indexDocument(store,manifest,{signal}),menus=namedWebsiteMenus(doc);
  if(menuId!==null&&(!researchId(menuId)||!menus.has(menuId)))throw new AppError('NOT_FOUND');
  const menu=readWebsiteMenu(doc,page.path,page.placements,menuId);
  return {revision:manifest.revision,items:menu.items,menus:[...menus.values()].map(({id,name,position})=>({id,name,position}))};
 },{signal});
}
export async function inheritSiteMenu(store,manifest,html,path,placements,{signal}){
 const {doc,page}=await indexDocument(store,manifest,{signal}),menus=namedWebsiteMenus(doc);
 for(const key of [null,...menus.keys()]){
  const base=readWebsiteMenu(doc,page.path,page.placements,key);if(!base.items.length&&!key)continue;
  const inherited=writeWebsiteMenu(html,path,placements,base,base.items,new Map(),menus.get(key));
  html=inherited.html;placements=websiteSourcePlacements(html,inherited.prior);
 }
 return {html,placements};
}
async function targetOwners(store,base,items,pages,files,options){
 const owners=new Map(),targets=new Map();
 async function visit(rows){
  for(const item of rows){
   const original=base.byKey.get(item.key);
   if(!original?.blocked&&item.href&&(!original||item.href!==original.href)){
    const [name,fragment]=item.href.split('#'),page=pages.get(name);
    if(page?.placements.length){
     if(!targets.has(name)){
      const target=menuTargetOwner(await store.readText(files.get(name),options));
      if(target){
       const grant=await store.source(target.id);
       if(!grant?.visible||grant.target!=='website'||grant.revision!==target.revision)throw new AppError('CONFLICT');
       target.title=grant.title;
      }
      targets.set(name,target);
     }
     const target=targets.get(name);
     if(target){
      if(fragment&&!target.anchors.has(fragment))throw new AppError('CONFLICT');
      owners.set(item.href,target);
     }
    }
   }
   await visit(item.children);
  }
 }
 await visit(items);return owners;
}
export function saveSiteMenu(store,id,{expectedRevision,path='index.html',items,menuId=null,name,position,create=false,remove=false,signal}={}){
 return store.scope(async()=>{
  requireRevision(expectedRevision);const manifest=await store.current(id,expectedRevision),index=await indexDocument(store,manifest,{signal});
  const menus=namedWebsiteMenus(index.doc),definition=menuId?{id:menuId,name,position}:null;
  if(menuId!==null){
   if(!researchId(menuId)||typeof create!=='boolean'||typeof remove!=='boolean'||create&&remove||typeof name!=='string'||!name.trim()||name.length>120||/[\u0000-\u001f]/.test(name)||!['header','footer'].includes(position))throw new AppError('INVALID');
   if(create===menus.has(menuId))throw new AppError('CONFLICT');
  }else if(create||remove)throw new AppError('INVALID');
  const base=readWebsiteMenu(index.doc,index.page.path,index.page.placements,menuId);
  const pages=new Map(manifest.pages.map(page=>[page.path,page])),files=new Map(manifest.files.map(file=>[file.name,file]));
  if(!pages.has(path))throw new AppError('NOT_FOUND');
  checkMenuChanges(items,base,new Set(manifest.pages.filter(page=>!page.draft).map(page=>page.path)));
  const owners=remove?new Map():await targetOwners(store,base,items,pages,files,{signal}),scripts=await store.scripts(manifest.files);
  let changed=false;
  operationTotal(manifest.pages.length);
  async function applyPage(page){
   signal?.throwIfAborted();
   const file=files.get(page.path),html=await store.readText(file,{signal});
   let updated;
   if(remove){
    const nav=namedWebsiteMenus(menuDocument(html)).get(menuId)?.nav;
    if(!nav)return;const loc=nav.sourceCodeLocation;
    updated={html:html.slice(0,loc.startOffset)+html.slice(loc.endOffset),prior:page.placements};
   }else updated=writeWebsiteMenu(html,page.path,page.placements,base,items,owners,definition);
   if(updated.html===html)return;
   const pictures=new Set();validateWebsiteHTML(updated.html,{scripts,file:page.path,pictures});
   for(const name of pictures){const picture=files.get(name);if(!picture||picture.draft&&!page.draft)throw new AppError('INVALID');}
   pages.set(page.path,{...page,pictures:[...pictures],placements:websiteSourcePlacements(updated.html,updated.prior)});
   files.set(page.path,await store.siteFile(id,page.path,updated.html,{draft:page.draft,signal}));changed=true;
  }
  for(const page of manifest.pages){await applyPage(page);operationAdvance(1,'menuSave');}
  if(!changed)return store.present(manifest,path,{signal});
  const nextPages=[...pages.values()],sources=[...new Map(nextPages.flatMap(page=>page.placements.map(({id,revision})=>[id,{id,revision}]))).values()];
  const usedPictures=new Set([...nextPages.flatMap(page=>page.pictures??[]),...Object.values(manifest.pictureStyles??{}).flat()]);
  const members=[...files.values()].filter(file=>!file.picture||usedPictures.has(file.name));
  const candidate={...manifest,pages:nextPages,sources,files:await store.siteAssets(members,sources,nextPages)};
  await store.assertSources(candidate);
  return store.present(await store.commit(candidate,{signal}),path,{signal});
 },{write:true,signal});
}
