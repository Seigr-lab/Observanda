import {withWebsiteSourceSelections} from './website-source-selections.js';
import {PublicationPreviewOwner} from './publication-preview-owner.js';
import {PublicationOwnerIdentities} from './publication-owner-identities.js';
import {websiteBook} from './web/website-sites-model.js';
// Template inheritance pins an existing immutable native website root. Only
// explicit reviewed commands change materialized authored content.
import {createHash,randomUUID} from 'node:crypto';
import {AppError} from './errors.js';
import {RecordDocument} from './record-document.js';
import {WebsiteCollectionIndex} from './website-collection-index.js';
import {digest,serialize} from './storage-format.js';
import {requireWebsiteTemplateInheritance,catalogueFormat,catalogueRequiresWebsiteTemplateInheritance} from './catalogue-format.js';
import {validTemplateLink,snapshotTemplateUse,placeTemplateMedia,createTemplateUse,previewTemplateUpdate,sourceTemplateUpdate} from './web/website-template-inheritance.js';
import {validSections} from './web/website-model.js';
import {validPresentation} from './web/media-presentation.js';
import {researchId} from './web/research-reference.js';
const templatePath=['document','website','templates'],presentationPath=['document','website','presentation'];
const hash=value=>digest(serialize(value)),invalid=()=>{throw new AppError('INVALID');},conflict=()=>{throw new AppError('CONFLICT');};
const same=(a,b)=>a===undefined||b===undefined?a===b:hash(a)===hash(b);
export function assertUnchangedWebsiteTemplateLinks(previous,next){
 if(!same(previous.home?.templateLink,next.home?.templateLink))invalid();
 for(const item of next.templates??[]){const before=(previous.templates??[]).find(value=>value.id===item.id);if(!same(before?.templateLink,item.templateLink))invalid();}
}
async function templates(document,options){const result=await document.field(templatePath,options);if(!Array.isArray(result.value)||result.value.length>100)invalid();return result.value;}
async function website(document,options){return {presentation:(await document.field(presentationPath,options)).value};}
async function template(document,id,options){const count=await document.tree.arrayLength(document.root,templatePath);if(count>100)invalid();for(let position=0;position<count;position++){options?.signal?.throwIfAborted();const path=[...templatePath,String(position)];if((await document.field([...path,'id'],options)).value===id)return {path,value:(await document.field(path,options)).value};}throw new AppError('NOT_FOUND');}
export async function assertNewWebsiteTemplateTarget(context,target,{store,sourceReader,site,snapshot,signal}={}){
 const [kind,id]=target.split(':'),book=websiteBook(snapshot.metadata,site);
 if(kind==='project'&&book.projects.some(value=>value.id===id)||kind==='notebook'&&book.notebooks.some(value=>value.id===id))return;
 if(kind==='entry'){const member=await store.member(snapshot,id);if(member){const notebookId=member.notebookId??(await store.record(id,member.revision)).notebookId;if(book.notebooks.some(value=>value.id===notebookId))return;}}
 let reader;try{
  const found=await withWebsiteSourceSelections(context.document,async sources=>{for await(const source of sources.items()){
   signal?.throwIfAborted();reader??=await sourceReader?.({signal});if(!reader)throw new AppError('ACCESS_LOCKED');
   const owner=await new PublicationPreviewOwner(source,reader,new PublicationOwnerIdentities(snapshot.metadata.id),{signal}).initialize();
   if(kind==='project'&&owner.projected.projects.some(value=>value.id===id&&value.share)||kind==='notebook'&&owner.projected.notebooks.some(value=>value.id===id&&value.share!==false)||kind==='entry'&&await owner.find(id))return true;
  }return false;},{signal});if(reader)await reader.verify();if(!found)invalid();
 }finally{await reader?.close();}
}
export async function websiteTemplateTarget(document,target,{indexes,signal}={}){
 const options={signal};if(target==='home')return {path:['document','website','home'],value:(await document.field(['document','website','home'],options)).value};
 if(typeof target!=='string')invalid();if(target.startsWith('template:'))return template(document,target.slice(9),options);
 const collection=target.startsWith('page:')?'pages':'layouts',key=collection==='pages'?target.slice(5):target,path=collection==='pages'?['document','pages']:['document','website','layouts'];
 const index=await WebsiteCollectionIndex.open(document,collection,indexes?.[collection],options);let position=null;
 if(index)position=(await index.item(key,options))?.position??null;
 else {const count=await document.tree.arrayLength(document.root,path);for(let at=0;at<count;at++){signal?.throwIfAborted();if((await document.field([...path,String(at),collection==='pages'?'id':'target'],options)).value===key){position=at;break;}}}
 if(position===null)throw new AppError('NOT_FOUND');const selected=[...path,String(position)];return {path:selected,value:(await document.field(selected,options)).value};
}
export async function exportWebsiteTemplateBinding(document,link,{signal}={}){
 if(!validTemplateLink(link))invalid();const baseline=new RecordDocument(document.blocks,link.root),owner=(await document.field(['id'],{signal})).value;
 if((await baseline.field(['id'],{signal})).value!==owner)invalid();
 const source=await template(baseline,link.templateId,{signal}),snapshot=snapshotTemplateUse(await website(baseline,{signal}),'template:'+link.templateId,source.value.sections);
 if(!validSections(snapshot.sections)||!validPresentation({media:snapshot.media.map(({sectionId,...row})=>({...row,scope:'template:'+link.templateId+'#'+sectionId})),covers:[]}))invalid();
 const ids=new Set(snapshot.sections.map(section=>section.id));if(link.sectionIds.length!==ids.size||link.sectionIds.some(row=>!ids.has(row.templateId)))invalid();return snapshot;
}
export async function retainImportedWebsiteTemplateBinding(context,{templateId,sectionIds,baseline},{signal}={}){
 if(!researchId(templateId)||!baseline||!validSections(baseline.sections))invalid();
 let document=await context.document.replace(templatePath,[{id:templateId,name:'Imported template baseline',sections:baseline.sections}],{signal});
 const site={presentation:{media:[],covers:[]}};site.presentation.media=placeTemplateMedia(site,'template:'+templateId,baseline,{replace:true});
 if(!validPresentation(site.presentation))invalid();document=await document.replace(presentationPath,site.presentation,{signal});await document.blocks.flush();
 const link={version:1,templateId,root:document.root,sectionIds:structuredClone(sectionIds)};await exportWebsiteTemplateBinding(context.document,link,{signal});await requireWebsiteTemplateInheritance(context.document.blocks.store.db);return link;
}
export async function validateWebsiteTemplateBinding(document,value,{signal,writing=false}={}){
 if(value?.templateLink===undefined)return false;try{await exportWebsiteTemplateBinding(document,value.templateLink,{signal});}catch(error){if(writing&&['CATALOGUE_DAMAGED','NOT_FOUND'].includes(error.code))invalid();throw error;}if(writing)await requireWebsiteTemplateInheritance(document.blocks.store.db);return true;
}
export async function verifyWebsiteTemplateBindings(store,document,{signal,writing=false}={}){
 const definitions=await templates(document,{signal}),ids=new Set(definitions.map(value=>value.id));let linked=false;
 const check=async value=>{if(value?.templateLink===undefined)return;if(!ids.has(value.templateLink.templateId))invalid();await validateWebsiteTemplateBinding(document,value,{signal});linked=true;};
 await check((await document.field(['document','website','home'],{signal})).value);
 for(const value of definitions){await check(value);const seen=new Set([value.id]);let parent=value.templateLink?.templateId;while(parent){if(seen.has(parent))invalid();seen.add(parent);parent=definitions.find(item=>item.id===parent)?.templateLink?.templateId;}}
 for(const path of [['document','pages'],['document','website','layouts']]){const count=await document.tree.arrayLength(document.root,path);for(let at=0;at<count;at++){signal?.throwIfAborted();const field=await document.field([...path,String(at),'templateLink'],{signal});if(field.found)await check({templateLink:field.value});}}
 if(linked&&writing)await requireWebsiteTemplateInheritance(store.db);
 if(linked&&!catalogueRequiresWebsiteTemplateInheritance(await catalogueFormat(store.db)))invalid();
}
// A deletion checks only compact link fields, never loads all page bodies.
export async function assertWebsiteTemplateDefinitions(document,previous,{signal}={}){
 const next=await templates(document,{signal}),ids=new Set(next.map(value=>value.id)),removed=new Set(previous.filter(value=>!ids.has(value.id)).map(value=>value.id));
 const check=value=>{if(value?.templateLink&&!ids.has(value.templateLink.templateId))invalid();};
 const home=(await document.field(['document','website','home'],{signal})).value;check(home);await validateWebsiteTemplateBinding(document,home,{signal,writing:true});
 for(const value of next){check(value);await validateWebsiteTemplateBinding(document,value,{signal,writing:true});const seen=new Set([value.id]);let parent=value.templateLink?.templateId;while(parent){if(seen.has(parent))invalid();seen.add(parent);parent=next.find(item=>item.id===parent)?.templateLink?.templateId;}}
 if(removed.size)for(const path of [['document','pages'],['document','website','layouts']]){const count=await document.tree.arrayLength(document.root,path);for(let at=0;at<count;at++){signal?.throwIfAborted();const link=(await document.field([...path,String(at),'templateLink'],{signal})).value;if(link&&removed.has(link.templateId))throw new AppError('INVALID',[{field:'Detach linked pages before deleting this template.'}]);}}
}
function deterministicIds(seed){let number=0;return()=>{const value=createHash('sha256').update(seed+':'+number++).digest('hex');return value.slice(0,8)+'-'+value.slice(8,12)+'-4'+value.slice(13,16)+'-a'+value.slice(17,20)+'-'+value.slice(20,32);};}
export async function reviewWebsiteTemplate(context,target,{signal,decisions={}}={}){
 const selected=await websiteTemplateTarget(context.document,target,{indexes:context.checkpoint?.collectionIndexes,signal}),link=selected.value.templateLink;
 if(!link)return {target,linked:false,changed:false,conflicts:[],changes:[],ready:true};
 const base=await exportWebsiteTemplateBinding(context.document,link,{signal}),definition=await template(context.document,link.templateId,{signal}),site=await website(context.document,{signal});
 const current=snapshotTemplateUse(site,target,selected.value.sections??[]),incoming=snapshotTemplateUse(site,'template:'+link.templateId,definition.value.sections),token=hash({root:context.document.root,target,link});
 const result=previewTemplateUpdate({link,base,current,incoming,root:context.document.root,makeId:deterministicIds(token),decisions});
 return {target,templateId:link.templateId,templateName:definition.value.name,linked:true,changed:!same(base,incoming),token,...result};
}
async function materialize(context,target,selected,result,{signal}={}){
 const site=await website(context.document,{signal});site.presentation.media=placeTemplateMedia(site,target,{sections:result.sections,media:result.media},{replace:true});
 const value={...selected.value,sections:result.sections,templateLink:result.link};if(!validSections(value.sections)||!validPresentation(site.presentation))invalid();
 context.document=await context.document.replace(selected.path,value,{signal});context.document=await context.document.replace(presentationPath,site.presentation,{signal});
 await validateWebsiteTemplateBinding(context.document,value,{signal});await requireWebsiteTemplateInheritance(context.document.blocks.store.db);
}
export async function changeWebsiteTemplate(context,operation,{signal}={}){
 const options={signal},document=context.document;
 if(operation.type==='template-derive'){
  const values=await templates(document,options);if(values.length>=100||values.some(value=>value.id===operation.id))invalid();
  const source=await template(document,operation.templateId,options),result=createTemplateUse({templateId:operation.templateId,root:document.root,source:snapshotTemplateUse(await website(document,options),'template:'+operation.templateId,source.value.sections),makeId:randomUUID});
  context.document=await document.splice(templatePath,values.length,0,[{id:operation.id,name:operation.name,sections:[]}],options);
  await materialize(context,'template:'+operation.id,{path:[...templatePath,String(values.length)],value:{id:operation.id,name:operation.name,sections:[]}},result,options);return;
 }
 const selected=await websiteTemplateTarget(document,operation.target,{indexes:context.checkpoint.collectionIndexes,signal});
 if(operation.type==='template-detach'){if(!selected.value.templateLink)invalid();context.document=await document.property(selected.path,'templateLink',undefined,{remove:true,signal});return;}
 if(operation.type==='template-update'){
  const definition=await template(document,operation.templateId,options);if(operation.target==='template:'+operation.templateId)invalid();
  const site=await website(document,options),current=snapshotTemplateUse(site,operation.target,selected.value.sections??[]),original=snapshotTemplateUse(site,'template:'+operation.templateId,definition.value.sections);
  const next=selected.value.templateLink?.templateId===operation.templateId?sourceTemplateUpdate({link:selected.value.templateLink,current,template:original,makeId:randomUUID}):current;
  if(!validSections(next.sections))invalid();site.presentation.media=placeTemplateMedia(site,'template:'+operation.templateId,next,{replace:true});
  context.document=await document.replace(definition.path,{...definition.value,sections:next.sections},options);context.document=await context.document.replace(presentationPath,site.presentation,options);
  if(selected.value.templateLink?.templateId===operation.templateId){const link={version:1,templateId:operation.templateId,root:context.document.root,sectionIds:next.sections.map((section,index)=>({templateId:section.id,pageId:current.sections[index].id}))};context.document=await context.document.property(selected.path,'templateLink',link,options);await validateWebsiteTemplateBinding(context.document,{templateLink:link},{signal,writing:true});}return;
 }
 if(operation.type==='template-link'){
  if(operation.target==='template:'+operation.templateId)invalid();const source=await template(document,operation.templateId,options),site=await website(document,options);
  const result=createTemplateUse({templateId:operation.templateId,root:document.root,source:snapshotTemplateUse(site,'template:'+operation.templateId,source.value.sections),makeId:randomUUID});
  if(operation.mode==='append'){const current=snapshotTemplateUse(site,operation.target,selected.value.sections??[]);result.sections=[...current.sections,...result.sections];result.media=[...current.media,...result.media];}
  await materialize(context,operation.target,selected,result,options);await assertWebsiteTemplateDefinitions(context.document,await templates(document,options),options);return;
 }
 if(operation.type==='template-accept'){
  const result=await reviewWebsiteTemplate(context,operation.target,{signal,decisions:operation.decisions});if(!result.linked||result.token!==operation.token)conflict();if(!result.ready)invalid();await materialize(context,operation.target,selected,result,options);return;
 }
 invalid();
}
