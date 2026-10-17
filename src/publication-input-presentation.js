// Presentation originals share the capture journal with pages and records.
// Only authenticated target references remain in the publication manifest.
import {randomUUID} from 'node:crypto';
import {logosFor} from './web/branding.js';
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {researchId} from './web/research-reference.js';
import {validWebsiteLayout,validWebsiteBranding} from './web/website-item-validation.js';
import {validWebsiteCollectionKey} from './web/website-collection-model.js';
import {publicationInputIds,readPublicationPage} from './publication-input-pages.js';
import {hasHomepage,usedAssetIds} from './web/website-layouts.js';
import {REGION_SLOTS,resolveRegion} from './web/website-regions.js';
import {publicSections,sectionItems,linkAvailable} from './web/website-model.js';
const invalid=()=>{throw new AppError('INVALID');},damaged=()=>{throw new AppError('JOB_DAMAGED');};
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()===keys;
const file=(job,id)=>'.observanda/release-inputs/'+job+'/'+id+'.json';
const names={layouts:'layoutInputs',branding:'brandingInputs'};
const valid=(collection,value,metadata)=>validWebsiteCollectionKey(collection,value?.target)&&(collection==='layouts'?validWebsiteLayout(value,{formatVersion:metadata.formatVersion??21}):validWebsiteBranding(value));
const validRef=(collection,value)=>exact(value,'bytes,fileId,sha256,target')&&validWebsiteCollectionKey(collection,value.target)&&researchId(value.fileId)&&typeof value.sha256==='string'&&/^[a-f0-9]{64}$/.test(value.sha256)&&Number.isSafeInteger(value.bytes)&&value.bytes>0;
function header(metadata,fail){if(!researchId(metadata?.id)||!Array.isArray(metadata?.website?.layouts)||metadata.website.layouts.length||!Array.isArray(metadata.branding)||metadata.branding.length)fail();}
async function exists(workspace,path){try{return await workspace.readMetadata(path,0)!==null;}catch(error){if(error.code==='LIMIT')return true;throw error;}}
export async function retainPublicationPresentation(workspace,id,metadata,streams,{signal,excludeIds=[]}={}){
 if(!researchId(id)||!exact(streams,'branding,layouts')||!Array.isArray(excludeIds)||excludeIds.some(value=>!researchId(value)))invalid();header(metadata,invalid);
 const reserved=publicationInputIds(metadata),result={presentationCounts:{}};for(const value of excludeIds)reserved.add(value);
 for(const [collection,name] of Object.entries(names)){
  const stream=streams[collection];if(!exact(stream,'count,items')||!Number.isSafeInteger(stream.count)||stream.count<0||!stream.items||typeof stream.items[Symbol.asyncIterator]!=='function'&&typeof stream.items[Symbol.iterator]!=='function')invalid();
  const refs=[],targets=new Set();result[name]=refs;result.presentationCounts[collection]=stream.count;
  for await(const value of stream.items){
   signal?.throwIfAborted();if(!valid(collection,value,metadata)||targets.has(value.target)||refs.length>=stream.count)invalid();targets.add(value.target);
   const raw=serialize(value),ref={target:value.target,fileId:null,sha256:digest(raw),bytes:Buffer.byteLength(raw)};
   do{signal?.throwIfAborted();ref.fileId=randomUUID();}while(reserved.has(ref.fileId)||await exists(workspace,file(id,ref.fileId)));
   reserved.add(ref.fileId);await workspace.writeMetadata(file(id,ref.fileId),raw);refs.push(ref);
  }
  if(refs.length!==stream.count)invalid();
 }
 signal?.throwIfAborted();return result;
}
export function validatePublicationPresentation(source){
 if([1,2,3,4].includes(source?.version))return;
 if(source?.version!==5||!researchId(source.id)||!exact(source.presentationCounts,'branding,layouts'))damaged();header(source.metadata,damaged);
 const reserved=publicationInputIds(source.metadata,source.records);
 for(const ref of source.pageInputs??[]){if(reserved.has(ref.fileId))damaged();reserved.add(ref.fileId);}
 for(const [collection,name] of Object.entries(names)){
  const count=source.presentationCounts[collection],refs=source[name],targets=new Set();
  if(!Number.isSafeInteger(count)||count<0||!Array.isArray(refs)||refs.length!==count)damaged();
  for(const ref of refs){if(!validRef(collection,ref)||targets.has(ref.target)||reserved.has(ref.fileId))damaged();targets.add(ref.target);reserved.add(ref.fileId);}
 }
}
async function read(workspace,source,collection,target,{signal}={}){
 signal?.throwIfAborted();if(!validWebsiteCollectionKey(collection,target))invalid();
 if([1,2,3,4].includes(source?.version)){const metadata=source.version===1?source.book:source.metadata;return (collection==='layouts'?metadata?.website?.layouts:metadata?.branding)?.find(value=>value.target===target)??null;}
 if(source?.version!==5||!researchId(source.id)||!Array.isArray(source[names[collection]]))damaged();
 let ref=null;for(const value of source[names[collection]])if(value?.target===target){if(ref)damaged();ref=value;}
 return readReference(workspace,source.id,source.metadata,collection,target,ref,{signal});
}
async function readReference(workspace,id,metadata,collection,target,ref,{signal}={}){
 signal?.throwIfAborted();if(!validWebsiteCollectionKey(collection,target))invalid();
 if(ref===null)return null;if(!validRef(collection,ref)||ref.target!==target)damaged();
 let raw;try{raw=await workspace.readMetadata(file(id,ref.fileId),ref.bytes);}catch(error){if(['LIMIT','ENOENT'].includes(error.code))damaged();throw error;}
 signal?.throwIfAborted();if(typeof raw!=='string'||Buffer.byteLength(raw)!==ref.bytes||digest(raw)!==ref.sha256)damaged();
 let value;try{value=JSON.parse(raw);}catch{damaged();}if(!valid(collection,value,metadata)||value.target!==target)damaged();return value;
}
// A batch owns a fixed reference snapshot. Copy only admitted descriptors into
// target maps, never file bodies or the caller's mutable arrays. Public single
// reads above keep inspecting their supplied source on every invocation.
export function publicationPresentationReader(workspace,source){
 if(source?.version!==5)invalid();validatePublicationPresentation(source);
 const id=source.id,metadata={formatVersion:source.metadata.formatVersion},maps={};
 for(const [collection,name] of Object.entries(names)){
  const index=new Map();for(const ref of source[name]){const owned=Object.freeze({...ref});if(!validRef(collection,owned)||index.has(owned.target))damaged();index.set(owned.target,owned);}maps[collection]=index;
 }
 return Object.freeze({
  layoutTargets:()=>maps.layouts.keys(),brandingTargets:()=>maps.branding.keys(),
  layout:(target,options)=>readReference(workspace,id,metadata,'layouts',target,maps.layouts.get(target)??null,options),
  branding:(target,options)=>readReference(workspace,id,metadata,'branding',target,maps.branding.get(target)??null,options)
 });
}
export const readPublicationLayout=(workspace,source,target,options)=>read(workspace,source,'layouts',target,options);
export const readPublicationBranding=(workspace,source,target,options)=>read(workspace,source,'branding',target,options);
// Keep section groups separate: authored parent identifiers are local to a
// layout, region or page. Browse inherits the home/first shared project region.
export function publicationPresentationSections(metadata,target){
 const layout=metadata.website.layouts.find(value=>value.target===target),regionTarget=target==='browse'?(hasHomepage(metadata)?'home':'project:'+metadata.projects.find(value=>value.share)?.id):target;
 return [{region:'layout',sections:layout?.sections??[]},...REGION_SLOTS.map(kind=>({region:kind,sections:resolveRegion(metadata.website,regionTarget,kind)?.sections??[]})),{region:'',sections:layout?.placement==='replace'?[]:target==='home'?metadata.website.home.sections:target?.startsWith('page:')?metadata.pages.find(value=>'page:'+value.id===target)?.sections??[]:[]}];
}
export function publicationBrandingTargets(metadata,target,selection,{editing=false}={}){
 const targets=new Set(['home']);if(validWebsiteCollectionKey('branding',target))targets.add(target);
 for(const {region,sections} of publicationPresentationSections(metadata,target))for(const section of publicSections(sections,selection,{region,editing,includeUnpublished:editing}))if(section.kind==='projects')for(const project of sectionItems(section,selection,{region}))targets.add('project:'+project.id);
 return targets;
}

// Inventory follows the same published sections and logo fallbacks as page
// rendering. Values are consumed individually; only media/target identities live
// across iterations, including overrides whose empty logos suppress a fallback.
export async function publicationPresentationMedia(workspace,source,selected,{signal}={}){
 const reader=publicationPresentationReader(workspace,source),metadata=source.metadata,targets=[...(selected.homeEnabled?['home']:[]),...['projects','notebooks','entries','pages'].flatMap(key=>selected[key].map(value=>({projects:'project',notebooks:'notebook',entries:'entry',pages:'page'}[key])+':'+value.id))];
 const originals=new Set(targets.filter(target=>target!=='home')),replaced=new Set(),cards=new Set(),assets=new Set();
 const sections=(values,region='')=>{
  const visible=publicSections(values,selected,{region});for(const id of usedAssetIds(visible))assets.add(id);
  for(const section of visible)if(section.kind==='projects')for(const project of sectionItems(section,selected,{region}))cards.add('project:'+project.id);
 };
 for(const target of reader.layoutTargets()){
  signal?.throwIfAborted();if(!linkAvailable(target,selected))continue;const layout=await reader.layout(target,{signal});
  if(layout.placement==='replace'){replaced.add(layout.target);originals.delete(layout.target);}sections(layout.sections,'layout');
 }
 if(selected.homeEnabled&&!replaced.has('home'))sections(metadata.website.home.sections);
 for(const ref of source.pageInputs){signal?.throwIfAborted();if(!replaced.has('page:'+ref.id)){const page=await readPublicationPage(workspace,source,ref.id,{signal});sections(page.sections);}}
 for(const target of targets){
  signal?.throwIfAborted();if(!resolveRegion(metadata.website,target,'header'))cards.add('home');
  for(const kind of REGION_SLOTS)sections(resolveRegion(metadata.website,target,kind)?.sections??[],kind);
 }
 const wanted=new Set([...originals,...cards]),media=new Map(selected.entries.flatMap(record=>record.attachments.filter(asset=>asset.share)).map(asset=>[asset.id,asset]));
 for(const asset of selected.assets)if(assets.has(asset.id))media.set(asset.id,asset);
 for(const target of wanted){signal?.throwIfAborted();const override=await reader.branding(target,{signal}),logos=override?override.logos:logosFor(metadata,target);for(const logo of logos)if(!media.has(logo.id))media.set(logo.id,{id:logo.id,kind:'image'});}
 return [...media.values()];
}
