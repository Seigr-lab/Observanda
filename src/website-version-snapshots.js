import {AppError} from './errors.js';
import {digest} from './storage-format.js';
import {authoredPageVersion} from './website-version-document.js';
import {omitPrivateStyleURLs} from './website-page-dependencies.js';

const root='.observanda/website-files/sites';
const maxDocumentBytes=64*1024*1024;
const managed=file=>file.sourceId||file.feedAsset||file.feedPage;
const derived=file=>file.themeSheet||file.appearanceSheet||file.entryDisplaySheet;
export const versionOwner=id=>root+'/'+(id??'default')+'/versions';
export const governedResources=manifest=>new Set(manifest.files.filter(managed).map(file=>file.name.toLowerCase()));
const sorted=(items,key)=>items.sort((a,b)=>a[key]<b[key]?-1:a[key]>b[key]?1:0);
function resource(file){
 const result={name:file.name,contentType:file.contentType,blob:file.blob,size:file.size,sha256:file.sha256};
 for(const key of ['draft','picture','recording','label'])if(file[key]!==undefined)result[key]=file[key];
 return result;
}
export async function versionJSON(store,id,name,value,signal){
 const bytes=Buffer.from(JSON.stringify(value));if(bytes.length>maxDocumentBytes)throw new AppError('LIMIT');
 return resource(await store.descriptor(name,bytes,{owner:versionOwner(id),signal}));
}
export async function readVersionJSON(store,id,file){
 if(!file||typeof file.sha256!=='string'||!/^[0-9a-f]{64}$/.test(file.sha256)||file.blob!==versionOwner(id)+'/files/'+file.sha256+'.json'||!Number.isSafeInteger(file.size)||file.size<0||file.size>maxDocumentBytes)throw new AppError('FORMAT');
 const bytes=await store.bytes(file.blob,{limit:file.size});
 if(bytes.length!==file.size||digest(bytes)!==file.sha256)throw new AppError('FORMAT');
 try{return JSON.parse(bytes.toString('utf8'));}catch{throw new AppError('FORMAT');}
}
function pageSettings(page){
 const result={path:page.path};
 for(const key of ['draft','stylePath','sharedDraftBase','instances'])if(page[key]!==undefined)result[key]=page[key];
 return result;
}
// Capture only changed authored page bytes. A source synchronization may change
// entire generated subtrees without changing a single byte of the author's work.
export async function versionSnapshot(store,manifest,prior,available,signal){
 const files=new Map(manifest.files.map(file=>[file.name,file]));
 const priorPages=new Map(prior?.pages.map(p=>[p.path,p])),priorFiles=new Map(prior?.assets.map(f=>[f.name,f]));
 const governed=governedResources(manifest),pages=[],assets=[];
 for(const page of manifest.pages){
  signal?.throwIfAborted();
  const file=files.get(page.path),former=priorPages.get(page.path);
  if(!file||managed(file))continue;
  const cfg=pageSettings(page);
  // A grant can newly govern an existing resource even if this page's bytes did
  // not change. Pin its current referenced subset as well as its HTML digest.
  const names=file.references?.filter(r=>governed.has(r.name.toLowerCase())).map(r=>r.name);
  const pin=digest(JSON.stringify([file.sha256,names??[...governed].sort()]));
  if(former?.input===pin&&(former.unavailable||available.has(former.document?.file.blob))){
   pages.push({...cfg,input:pin,...(former.unavailable?{unavailable:true}:{own:former.own,document:former.document,...(former.stamps?{stamps:former.stamps}:{})})});continue;
  }
  const html=await store.readText(file,{signal}),model=authoredPageVersion(html,page.path,governed);
  if(!model){pages.push({...cfg,input:pin,unavailable:true});continue;}
  const own=digest(JSON.stringify([model.chunks,model.slots.map(s=>s.id)]));
  let document=former?.own===own&&available.has(former.document?.file.blob)?former.document:null;
  if(!document){
   if(model.slots.length){
    document={kind:'template',file:await versionJSON(store,manifest.id,'page.json',model,signal)};
    available.add(document.file.blob);
   }
   else document={kind:'html',file:resource(file)};
  }
  // Two editions may share every authored byte whilst their permitted source
  // sections differ. Record per-edition fingerprints, without retaining those
  // sections or rewriting the shared document template.
  const stamps=document===former?.document&&model.slots.length?model.slots.map(slot=>slot.stamp):null;
  pages.push({...cfg,input:pin,own,document,...(stamps?{stamps}:{})});
 }
 for(const file of manifest.files){
  signal?.throwIfAborted();
  if(managed(file)||derived(file)||file.name.endsWith('.html'))continue;
  let held=resource(file);
  if(file.name.endsWith('.css')&&governed.size){
   const names=file.references?.filter(r=>governed.has(r.name.toLowerCase())).map(r=>r.name);
   if(!names||names.length){
    const pin=digest(JSON.stringify([file.sha256,names??[...governed].sort()]));
    const former=priorFiles.get(file.name);
    if(former?.input===pin&&available.has(former.blob))held={...former,draft:file.draft};
    else{
     const css=await store.readText(file,{signal}),clean=omitPrivateStyleURLs(css,file.name,governed);
     if(clean!==css){
      held={...held,...resource(await store.descriptor(file.name,clean,{owner:versionOwner(manifest.id),signal})),input:pin};
      available.add(held.blob);
     }
    }
   }
  }
  assets.push(held);
 }
 const components=(manifest.components??[]).map(main=>({...main,pictures:main.pictures.map(file=>file.name),...(main.recordings?{recordings:main.recordings.map(file=>file.name)}:{})}));
 const settings={name:manifest.name,cssPath:manifest.cssPath,components,pageDesigns:manifest.pageDesigns??[],themeBook:manifest.themeBook??null,appearance:manifest.appearance??null};
 return {format:1,pages:sorted(pages,'path'),assets:sorted(assets,'name'),settings};
}
export function snapshotIdentity(snapshot){
 const pageKeys=snapshot.pages.map(({input,document,stamps,...state})=>state);
 return digest(JSON.stringify([pageKeys,snapshot.assets.map(({input,...asset})=>asset),snapshot.settings]));
}
export function snapshotFiles(snapshot){
 const unique=new Map(snapshot.assets.map(file=>[file.blob,file]));
 for(const page of snapshot.pages)if(page.document){const {file}=page.document;unique.set(file.blob,file);}
 return unique;
}
