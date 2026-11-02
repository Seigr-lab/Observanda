import {AppError} from './errors.js';
import {checkMenuChanges,readWebsiteMenu,writeWebsiteMenu,menuTargetOwner} from './website-file-menu.js';
import {websiteSourcePlacements} from './website-file-html.js';
import {validateWebsiteHTML} from './website-file-policy.js';

const requireRevision=revision=>{if(typeof revision!=='string'||!/^[a-f0-9]{64}$/.test(revision))throw new AppError('INVALID');};
async function indexMenu(store,manifest,options){
 const file=manifest.files.find(item=>item.name==='index.html'),page=manifest.pages.find(item=>item.path==='index.html');
 return readWebsiteMenu(await store.readText(file,options),page.path,page.placements);
}
export function readSiteMenu(store,id,{expectedRevision,signal}={}){
 return store.scope(async()=>{
  requireRevision(expectedRevision);const manifest=await store.current(id,expectedRevision);
  const menu=await indexMenu(store,manifest,{signal});return {revision:manifest.revision,items:menu.items};
 },{signal});
}
export async function inheritSiteMenu(store,manifest,html,path,placements,{signal}){
 const base=await indexMenu(store,manifest,{signal});
 if(!base.items.length)return {html,placements};
 const inherited=writeWebsiteMenu(html,path,placements,base,base.items,new Map());
 return {html:inherited.html,placements:websiteSourcePlacements(inherited.html,inherited.prior)};
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
export function saveSiteMenu(store,id,{expectedRevision,path='index.html',items,signal}={}){
 return store.scope(async()=>{
  requireRevision(expectedRevision);const manifest=await store.current(id,expectedRevision),base=await indexMenu(store,manifest,{signal});
  const pages=new Map(manifest.pages.map(page=>[page.path,page])),files=new Map(manifest.files.map(file=>[file.name,file]));
  if(!pages.has(path))throw new AppError('NOT_FOUND');
  checkMenuChanges(items,base,new Set(manifest.pages.filter(page=>!page.draft).map(page=>page.path)));
  const owners=await targetOwners(store,base,items,pages,files,{signal}),scripts=await store.scripts(manifest.files);
  let changed=false;
  for(const page of manifest.pages){
   signal?.throwIfAborted();
   const file=files.get(page.path),html=await store.readText(file,{signal});
   const updated=writeWebsiteMenu(html,page.path,page.placements,base,items,owners);
   if(updated.html===html)continue;
   validateWebsiteHTML(updated.html,{scripts,file:page.path});
   pages.set(page.path,{...page,placements:websiteSourcePlacements(updated.html,updated.prior)});
   files.set(page.path,await store.siteFile(id,page.path,updated.html,{draft:page.draft,signal}));changed=true;
  }
  if(!changed)return store.present(manifest,path,{signal});
  const nextPages=[...pages.values()],sources=[...new Map(nextPages.flatMap(page=>page.placements.map(({id,revision})=>[id,{id,revision}]))).values()];
  const candidate={...manifest,pages:nextPages,sources,files:await store.siteAssets([...files.values()],sources,nextPages)};
  await store.assertSources(candidate);
  return store.present(await store.commit(candidate,{signal}),path,{signal});
 },{write:true,signal});
}
