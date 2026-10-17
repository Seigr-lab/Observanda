// An editor projection is a read model, never a replacement document. Page
// destinations contain labels; only the selected page carries authored content.
import {AppError} from './errors.js';
import {WebsiteEditorStore} from './website-editor-store.js';
import {WebsiteCollectionIndex} from './website-collection-index.js';
import {websiteDocumentHeader} from './website-document-validation.js';
import {websiteBook} from './web/website-sites-model.js';
import {validWebsitePin,sameWebsitePin} from './web/website-pin.js';
import {validWebsiteDraftPin} from './web/website-draft-pin.js';
import {WEBSITE_COLLECTION_PATHS} from './web/website-collection-model.js';
import {usedAssetIds,hasHomepage} from './web/website-layouts.js';
import {REGION_SLOTS,resolveRegion} from './web/website-regions.js';
const invalid=()=>{throw new AppError('INVALID');};
async function rows(document,collection,descriptor,{signal,consume}){
 const path=WEBSITE_COLLECTION_PATHS[collection],index=await WebsiteCollectionIndex.open(document,collection,descriptor,{signal});
 const count=await document.tree.arrayLength(document.root,path);
 for(let offset=0;offset<count;offset+=100){
  signal?.throwIfAborted();
  if(index)for(const row of (await index.window({offset,limit:100,signal})).rows)await consume(row);
  else for(let position=offset;position<Math.min(offset+100,count);position++){
   const key=(await document.field([...path,String(position),collection==='navigation'?'target':'id'],{signal})).value;
   await consume({position,key});
  }
 }
}
export async function websiteEditorProjection(store,websiteId,{websitePin,websiteDraft,designTarget,pageLabels=true,signal}={}){
 if(!validWebsitePin(websitePin)||websitePin.websiteId!==websiteId||websiteDraft!==undefined&&!validWebsiteDraftPin(websiteDraft))invalid();
 if(designTarget!==undefined&&typeof designTarget!=='string'||typeof pageLabels!=='boolean')invalid();
 const selected=await new WebsiteEditorStore(store).document(websiteId,{websitePin,...(websiteDraft?{draftId:websiteDraft.id,draftRevision:websiteDraft.revision}:{}),signal});
 if(!sameWebsitePin(websitePin,selected.websitePin))throw new AppError('CONFLICT');
 const {document,collectionIndexes}=selected,site=await websiteDocumentHeader(document,{signal}),raw=await store.snapshot(websitePin.researchSnapshotId);
 const metadata=websiteBook(raw.metadata,site);metadata.pages=[];metadata.website.navigation=[];metadata.website.assets=[];
 if(pageLabels)await rows(document,'pages',collectionIndexes?.pages,{signal,consume:async row=>{
  const path=[...WEBSITE_COLLECTION_PATHS.pages,String(row.position)];
  if(designTarget==='page:'+row.key){metadata.pages.push((await document.field(path,{signal})).value);return;}
  const title=row.label??(await document.field([...path,'title'],{signal})).value,share=row.shared??(await document.field([...path,'share'],{signal})).value;
  metadata.pages.push({id:row.key,title,share,body:'',sections:[]});
 }});
 if(designTarget!==undefined)await rows(document,'navigation',collectionIndexes?.navigation,{signal,consume:async row=>metadata.website.navigation.push((await document.field([...WEBSITE_COLLECTION_PATHS.navigation,String(row.position)],{signal})).value)});
 const layout=metadata.website.layouts.find(item=>item.target===designTarget),page=designTarget?.startsWith('page:')?metadata.pages.find(page=>'page:'+page.id===designTarget):null;
 const regionTarget=designTarget==='browse'?(hasHomepage(metadata)?'home':'project:'+metadata.projects.find(project=>project.share)?.id):designTarget;
 const sections=designTarget===undefined?[]:[...(layout?.sections??[]),...REGION_SLOTS.flatMap(kind=>resolveRegion(metadata.website,regionTarget,kind)?.sections??[]),...(layout?.placement==='replace'?[]:designTarget==='home'?metadata.website.home.sections:page?.sections??[])];
 metadata.website.assets=await websiteEditorAssets(document,collectionIndexes,sections,{signal});
 return {metadata,snapshot:{...raw,metadata,websiteSelection:site.selection,websitePin},websitePin,document,collectionIndexes,site};
}

// Asset bodies are selected only after the final page/region target is known.
// Federation may choose the first external project as its browse-page region.
export async function websiteEditorAssets(document,collectionIndexes,sections,{signal}={}){
 const wanted=new Set(usedAssetIds(sections)),values=[];if(!wanted.size)return values;
 const assets=await WebsiteCollectionIndex.open(document,'assets',collectionIndexes?.assets,{signal});
 const append=async row=>{values.push((await document.field([...WEBSITE_COLLECTION_PATHS.assets,String(row.position)],{signal})).value);};
 if(assets){for(const id of wanted){signal?.throwIfAborted();const row=await assets.item(id,{signal});if(row)await append(row);}}
 else await rows(document,'assets',null,{signal,consume:async row=>{if(wanted.has(row.key))await append(row);}});
 return values;
}
