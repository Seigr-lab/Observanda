// Derive query content from a pinned original one owned value at a time. Large
// collections are retained as references, never accumulated into another record.
import {SOURCE_PUBLICATION_VERSION} from './web/source-publication-permissions.js';
import {RecordContainerBuilder} from './record-tree-values.js';
import {retainRecordText} from './record-text-retention.js';
import {recordQueryDocument,recordReferenceTargets} from './web/record-query.js';
import {researchCardSources} from './web/research-card-items.js';
import {recordPublicationSummary} from './web/record-publication-summary.js';
import {publicationCard} from './web/publication-card.js';
import {recordEditionInventory} from './web/publication-inventory.js';
import {publicationDescriptorDetails} from './publication-record-descriptor.js';
import {bookSelectors,placedFigures} from './web/book-selectors.js';
import {proseText,proseReferences} from './web/prose-model.js';
import {attemptDocumentHeader,attemptDocumentReferences,attemptDocumentSearchParts} from './record-attempt-document.js';
import {withScratch} from './scratch-work.js';
import {resultDocumentHeader,resultDocumentStatements} from './record-result-document.js';
import {recordTemplateHeader} from './record-template-document.js';
import {recordProjectionReuse} from './record-projection-reuse.js';
import {mapRecordProjection} from './record-projection-map.js';
import {filterRecordProjection} from './record-projection-filter.js';
import {groupRecordProjection} from './record-projection-groups.js';
import {attemptReferenceGroups} from './record-attempt-query.js';

const collections=['sections','contributors','relations','figures','attachments','tags'];
const depends=(collection,...fields)=>({collection:Array.isArray(collection)?collection:[collection],fields});
export async function retainedQueryProjection(document,revision,{signal,previous,searchText:retainedText,referenceTargets:retainedReferences}={}){
 if(previous&&(await previous.tree.selected(previous.root,['publicationDescriptor','sourcePermissionVersion'])).value!==SOURCE_PUBLICATION_VERSION)previous=null;
 const {tree,blocks}=document,header={},reuse=recordProjectionReuse(document,previous,{signal});
 for(const name of await tree.propertyNames(document.root)){
  signal?.throwIfAborted();
  Object.defineProperty(header,name,{value:collections.includes(name)?[]:name==='attempt'?await attemptDocumentHeader(document,{signal}):name==='results'?await resultDocumentHeader(document,{signal}):name==='template'?await recordTemplateHeader(document,{signal}):(await document.field([name],{signal})).value,enumerable:true});
 }
 const empty={...header,body:'',attempt:undefined},plain={...recordQueryDocument(header),publication:recordPublicationSummary(header),publicationCard:publicationCard(header),publicationDescriptor:null,editionInventory:recordEditionInventory(header,revision),recordRevision:revision};
 const object=async(value,references={})=>{
  const builder=new RecordContainerBuilder(blocks,'object');
  for(const name of Object.keys(value)){signal?.throwIfAborted();await builder.add({name,value:references[name]??await tree.retain(value[name])});}
  return builder.finish();
 };
 async function* items(field,names=null){
  for await(const ref of document.items(Array.isArray(field)?field:[field],{signal})){
   if(!names){yield await tree.read(ref.value);continue;}
   const item={};for(const name of names){const selected=await tree.selected(ref.value,[name]);if(selected.found)item[name]=selected.value;}yield item;
  }
 }
 const array=async(source)=>{
  const builder=new RecordContainerBuilder(blocks,'array');
  for await(const value of source){signal?.throwIfAborted();await builder.add({value:await tree.retain(value)});}return builder.finish();
 };
 async function* map(field,names,project){for await(const item of items(field,names))yield* project(item);}
 const mapped=(path,field,names,project,context=[])=>{
  const collection=Array.isArray(field)?field:[field],build=()=>array(map(field,names,item=>[project(item)]));
  return reuse(path,[depends(collection,...names),...context],()=>mapRecordProjection(document,previous,{path,collection,fields:names,context,project},build,{signal}));
 };
 const filtered=(path,collection,fields,include,project)=>reuse(path,[depends(collection,...fields)],()=>filterRecordProjection(document,previous,{path,collection:[collection],fields,include,project},{signal}));
 // Card prose may embed figures. Resolve those exact identities against the
 // original's collections before replacing the descriptor's larger arrays.
 const placed=placedFigures(header),figureContext={...header,figures:[],attachments:[]};
 if(placed.size){
  for await(const item of items('figures',['id']))if(placed.has(item.id))figureContext.figures.push(item);
  for await(const item of items('attachments',['id','kind','caption','alt','share']))if(placed.has(item.id))figureContext.attachments.push(item);
 }
 plain.publicationDescriptor=publicationDescriptorDetails(figureContext);
 async function* searchParts(){
  yield header.title;yield proseText(header.body);yield header.outcome??'';yield* items('tags');
  for await(const item of items('sections',['title','body'])){yield item.title;yield proseText(item.body);}
  for await(const item of items('contributors',['name','role'])){yield item.name;yield item.role;}
  yield header.template?.label??'';if(header.template)for await(const child of document.properties(['template','values'],{signal}))yield await tree.read(child.value);
  if(header.attempt)yield* attemptDocumentSearchParts(document,{signal});
  for await(const item of resultDocumentStatements(document,{signal,fields:['title','text','limitations']})){yield item.title;yield item.text;yield item.limitations;}
 }
 async function* searchText(){let first=true;for await(const value of searchParts()){if(!first)yield ' ';first=false;yield String(value??'').toLocaleLowerCase();}}
 async function* proseMentions(){
  yield* proseReferences(header.body);
  for await(const item of items('sections',['body']))yield* proseReferences(item.body);
 }
 async function* references(){
  for await(const item of items('relations',['type','target']))yield* recordReferenceTargets({...empty,relations:[item]});
  for await(const target of proseMentions())if(target.kind==='record')yield {workspaceId:target.workspaceId,id:target.id,type:'Mentioned in text',...(target.revision?{revision:target.revision}:{})};
  for await(const ref of attemptDocumentReferences(document,{signal}))if(ref.kind==='record')yield {workspaceId:ref.workspaceId,id:ref.id,type:ref.label,revision:ref.revision};
 }
 const referenceTargets=retainedReferences??await reuse(['referenceTargets'],[depends('relations','type','target'),['body'],depends('sections','body'),['attempt']],()=>withScratch(async seen=>{
  const builder=new RecordContainerBuilder(blocks,'array');
  for await(const value of references()){signal?.throwIfAborted();if(await seen.add(JSON.stringify(value)))await builder.add({value:await tree.retain(value)});}return builder.finish();
 },{signal}));
 const cardSources={};
 for(const [provider,field,names] of [
  ['sections','sections',['id','title']],['contributors','contributors',['id','name']],
  ['relations','relations',['id','label','type']],['figures','figures',['id','title']],['files','attachments',['id','caption','kind']]
 ])cardSources[provider]=await mapped(['cardSources',provider],field,names,item=>researchCardSources({...empty,[field]:[item]})[provider][0],[['id'],...(provider==='figures'?[['title']]:[])]);
 const attachments=await mapped(['publication','attachments'],'attachments',['id','kind','share'],item=>item);
 const images=await filtered(['publicationCard','attachments'],'attachments',['id','kind','caption','alt','share'],item=>item.kind==='image',item=>item);
 const sharedImages=await filtered(['publicationDescriptor','attachments'],'attachments',['id','kind','caption','alt','share'],item=>item.kind==='image'&&item.share,item=>item);
 const grouped=(path,owners,groups)=>reuse(path,owners,()=>groupRecordProjection(document,previous,{path,groups},{signal}));
 const selectors=()=>grouped(['publicationDescriptor','selectors'],[depends('sections','id','title','body','share'),depends('figures','id','title'),depends('attachments','id','kind','caption','alt','share'),['body']],[
  {collection:['sections'],fields:['id','title','share'],project:item=>item.share===false?[]:[{version:1,kind:'section',id:item.id,label:item.title}]},
  {collection:['figures'],fields:['id','title'],project:item=>[{version:1,kind:'figure',id:item.id,label:item.title}]},
  {collection:['attachments'],fields:['id','kind','caption','alt','share'],project:item=>item.kind==='image'&&item.share?[{version:1,kind:'figure',id:item.id,label:item.caption||item.alt}]:[]},
  {field:['body'],project:body=>bookSelectors({body})},
  {collection:['sections'],fields:['body','share'],project:item=>item.share===false?[]:bookSelectors({body:item.body})}
 ]);
 const mentions=body=>proseReferences(body).map(target=>({role:'mention',target}));
 const relations=()=>grouped(['publicationDescriptor','relations'],[depends('relations','role','target'),depends('sections','body','share'),['body']],[
  {collection:['relations'],fields:['role','target'],project:item=>[{role:item.role??'related',target:item.target}]},
  {field:['body'],project:mentions},
  {collection:['sections'],fields:['body','share'],project:item=>item.share===false?[]:mentions(item.body)}
 ]);
 const tags=await document.reference(['tags'],{signal});
 const descriptor=await object({...plain.publicationDescriptor,revision},{
  tags,
  references:await grouped(['publicationDescriptor','references'],[['attempt']],attemptReferenceGroups(ref=>{if(ref.kind!=='record')return [];const {workspaceId,kind,id,revision}=ref;return [{workspaceId,kind,id,revision}];})),
  attachments:sharedImages,selectors:await selectors(),relations:await relations(),
  media:await filtered(['publicationDescriptor','media'],'attachments',['id','kind','share'],item=>item.share,item=>item)
 });
 const inventory=plain.editionInventory,choice=inventory.choice;
 const inventoryRoot=await object(inventory,{
  choice:await object(choice,{
   fields:header.template?await mapped(['editionInventory','choice','fields'],['template','fields'],['key'],item=>item.key):await tree.retain([]),
   sections:await filtered(['editionInventory','choice','sections'],'sections',['id','share'],item=>item.share!==false,item=>item.id),
   attachments:await filtered(['editionInventory','choice','attachments'],'attachments',['id','share'],item=>item.share,item=>item.id),
   figures:await mapped(['editionInventory','choice','figures'],'figures',['id'],item=>({id:item.id,data:false}))
  }),
  sections:await filtered(['editionInventory','sections'],'sections',['id','title','share'],item=>item.share!==false,({id,title})=>({id,title})),
  fields:header.template?await mapped(['editionInventory','fields'],['template','fields'],['key','label'],item=>({id:item.key,title:item.label})):await tree.retain([]),
  attachments:await filtered(['editionInventory','attachments'],'attachments',['id','kind','caption','alt','share'],item=>item.share===true,item=>({id:item.id,kind:item.kind,title:item.caption||item.alt||''})),
  figures:await mapped(['editionInventory','figures'],'figures',['id','title'],item=>item)
 });
 const root=await object(plain,{
  tags,referenceTargets,cardSources:await object(plain.cardSources,cardSources),searchText:retainedText??await reuse(['searchText'],[['title'],['body'],['outcome'],['tags'],depends('sections','title','body'),depends('contributors','name','role'),['template'],['attempt'],['results']],()=>retainRecordText(blocks,searchText(),{signal})),
  publication:await object(plain.publication,{attachments}),publicationCard:await object(plain.publicationCard,{tags,attachments:images}),
  publicationDescriptor:descriptor,editionInventory:inventoryRoot
 });
 const {searchText:ignoredText,referenceTargets:ignoredTargets,cardSources:ignoredCards,publication:ignoredPublication,publicationCard:ignoredCard,publicationDescriptor:ignoredDescriptor,editionInventory:ignoredInventory,...browse}=plain;
 void ignoredText;void ignoredTargets;void ignoredCards;void ignoredPublication;void ignoredCard;void ignoredDescriptor;void ignoredInventory;
 return {root,browse,summaryRoot:await object(browse,{tags})};
}
