import {AppError} from './errors.js';
import {hasHomepage,usedAssetIds} from './web/website-layouts.js';
import {publicSections} from './web/website-model.js';
import {resolveRegion,REGION_SLOTS} from './web/website-regions.js';
import {publicationCollectionKey} from './web/publication-collections.js';
import {researchReference,parseResearchReference} from './web/research-reference.js';
import {proseReferences} from './web/prose-model.js';
import {publicationTargetSelector} from './publication-prose.js';
import {selectorAnchor} from './web/book-selectors.js';
import {projectPublication} from './publication-projection.js';
import {publicationPage} from './publication-page.js';

const collectionKind={project:'projects',notebook:'notebooks',page:'pages',entry:'records'};
const pageLabel=value=>({...value,body:'',sections:[]});
const card=({id,title,notebookId,occurredOn,status,tags,type,excerpt,hasBody,attachments=[]})=>({id,title,notebookId,occurredOn,status,tags,type,excerpt,hasBody,attachments});
const visible=(section,sections)=>{
 if(!section.show)return false;let parent=section.parentId;
 while(parent){const value=sections.find(item=>item.id===parent);if(!value?.show)return false;parent=value.parentId;}return true;
};

// Collection selection is an iterator over the retained owner. It never borrows
// the author's live workspace or fills the projection with an entire directory.
export async function* publicationCollectionItems(input,section,{signal}={}){
 const filter=section.filter??{},kind=section.kind;let count=0;
 if(kind==='pages'&&(filter.projectId||filter.tag))return;
 const reverse=section.feed?.order==='oldest'||section.feed?.order==='reverse-alphabetical';
 const values=kind==='records'?input.records({projectId:filter.projectId??undefined,reverse}):input.items(kind,{...(section.feed?{index:'title',reverse}:{}),shared:true,...(kind==='notebooks'&&filter.projectId?{projectId:filter.projectId}:{})});
 for await(const value of values){
  signal?.throwIfAborted();
  if(kind==='projects'&&filter.projectId&&value.id!==filter.projectId||filter.tag&&!value.tags?.includes(filter.tag))continue;
  yield value;if(filter.limit&&++count>=filter.limit)return;
 }
}
export async function publicationCollectionCount(input,section,{signal}={}){
 signal?.throwIfAborted();const filter=section.filter??{},kind=section.kind;let count;
 if(kind==='pages'&&(filter.projectId||filter.tag))return 0;
 // The retained scope indexes include historical records and only admitted
 // page/book destinations. Tags still need their exact per-row predicate.
 if(!filter.tag){
  if(kind==='records')count=await input.recordCount({projectId:filter.projectId??undefined});
  else if(kind==='projects'&&filter.projectId)count=(await input.get('projects',filter.projectId))?.share?1:0;
  else if(['projects','pages','notebooks'].includes(kind))count=await input.count(kind,{shared:true,...(kind==='notebooks'&&filter.projectId?{projectId:filter.projectId}:{})});
 }
 if(count===undefined){count=0;for await(const value of publicationCollectionItems(input,section,{signal}))count++;}
 signal?.throwIfAborted();return filter.limit?Math.min(count,filter.limit):count;
}

async function remember(plan,kind,value){
 if(!value)return null;const map=plan.values[kind];if(!map)throw new AppError('JOB_DAMAGED');map.set(value.id,value);
 if(kind==='records'){const notebook=await plan.input.notebook(value.notebookId);if(notebook)await remember(plan,'notebooks',notebook);}
 if(kind==='notebooks'){const project=await plan.input.project(value.projectId);if(project)await remember(plan,'projects',project);}
 return value;
}
async function destination(plan,href){
 const parsed=parseResearchReference(href);
 if(parsed){
  const key=researchReference(parsed);if(plan.links.has(key))return plan.links.get(key);
  let item=null,result=null;
  if(parsed.kind==='workspace')result=parsed.workspaceId===plan.metadata.id&&parsed.id===plan.metadata.id&&hasHomepage(plan.metadata)?'home':null;
  else{
   item=parsed.kind==='record'?await plan.input.recordTarget(parsed):await plan.input.collectionTarget(parsed);
   if(item){
    await remember(plan,parsed.kind==='record'?'records':collectionKind[parsed.kind],item);
    const selector=publicationTargetSelector(item,parsed.selector);
    if((!parsed.revision||item.revision===parsed.revision)&&(!parsed.selector||selector))result=(parsed.kind==='record'?'entry':parsed.kind)+':'+item.id+(selector?'#'+selectorAnchor(selector):'');
   }
  }
  plan.links.set(key,result);plan.references.set(key,item);return result;
 }
 if(typeof href!=='string')return null;
 if(href.startsWith('#')||/^(https?:|mailto:|tel:)/.test(href))return href;
 const target=href.split('#')[0],value=await plan.input.target(target);if(!value)return null;
 if(target!=='home'){const [kind]=target.split(':');await remember(plan,collectionKind[kind],value);}
 return href;
}
async function richLinks(plan,node){for(const mark of node?.marks??[])if(mark.type==='link')await destination(plan,mark.attrs.href);for(const child of node?.content??[])await richLinks(plan,child);}
async function branding(plan,target){const value=await plan.input.get('branding',target);if(value)plan.branding.set(target,value);}
function materialize(plan){
 const metadata={...plan.metadata,projects:[...plan.values.projects.values()],notebooks:[...plan.values.notebooks.values()],pages:[...plan.values.pages.values()].map(value=>value.id===plan.page?.id?plan.page:pageLabel(value)),branding:[...plan.branding.values()],website:{...plan.metadata.website,layouts:plan.layout?[plan.layout]:[],assets:[...plan.assets.values()],navigation:[],presentation:{media:[...plan.presentation.values()],covers:[...plan.covers.values()]}}};
 const selection={...metadata,homeEnabled:hasHomepage(metadata),assets:metadata.website.assets,entries:[...plan.originals.values()],recordCards:[...plan.cards.values()]};return {metadata,selection};
}
async function loadCard(plan,kind,value){
 await remember(plan,kind==='records'?'records':kind,value);
 if(kind==='records'){plan.cards.set(value.id,card(value));const cover=await plan.input.get('covers',value.id);if(cover)plan.covers.set(value.id,cover);}
 else if(kind==='projects'){value={...value,recordCount:await plan.input.recordCount({projectId:value.id})};plan.values.projects.set(value.id,value);await branding(plan,'project:'+value.id);}
}

// The plan owns only one target's original and a first item per visible
// collection. Those first items admit sections; later cards remain iterators.
export async function publicationInputPlan(input,target,{signal}={}){
 signal?.throwIfAborted();const metadata=await input.metadata(),selected=target==='browse'?await input.recordCount({historical:false})>0?{target}:null:await input.target(target);if(!selected)throw new AppError('JOB_DAMAGED');
 const plan={input,target,metadata,signal,values:Object.fromEntries(['projects','notebooks','pages','records'].map(name=>[name,new Map()])),originals:new Map(),cards:new Map(),assets:new Map(),branding:new Map(),covers:new Map(),presentation:new Map(),links:new Map(),references:new Map(),collections:[],groups:[],availability:[]};
 const [kind,id]=target.split(':');plan.layout=await input.get('layouts',target);
 if(kind==='page'){plan.page=await input.page(id);await remember(plan,'pages',selected);}
 else if(kind==='entry'){await remember(plan,'records',selected);plan.originals.set(id,await input.record(id));}
 else if(collectionKind[kind])await remember(plan,collectionKind[kind],selected);
 if(target==='browse'&&!hasHomepage(metadata)){for await(const project of input.items('projects',{shared:true})){await remember(plan,'projects',project);break;}}
 await branding(plan,'home');if(target!=='browse')await branding(plan,target);
 const regionTarget=target==='browse'?(hasHomepage(metadata)?'home':'project:'+plan.values.projects.keys().next().value):target;
 plan.groups=[{region:'layout',sections:plan.layout?.sections??[]},...REGION_SLOTS.filter(region=>target!=='browse'||region==='footer').map(region=>({region,sections:resolveRegion(metadata.website,regionTarget,region)?.sections??[]})),{region:'',sections:plan.layout?.placement==='replace'?[]:target==='home'?metadata.website.home.sections:plan.page?.sections??[]}];
 for(const group of plan.groups)for(const section of group.sections){
  signal?.throwIfAborted();if(!visible(section,group.sections))continue;
  if(['records','projects','pages'].includes(section.kind)){
   const key=publicationCollectionKey(section,group.region);let first=null;
   for await(const value of publicationCollectionItems(input,section,{signal})){first=value;await loadCard(plan,section.kind,value);break;}
   plan.collections.push({key,section,first});
  }
  if(section.kind==='media'){
   const row=await input.get('records',section.entryId);if(row){await remember(plan,'records',row);plan.originals.set(row.id,await input.record(row.id));}
  }
  for(const id of usedAssetIds([section])){const value=await input.get('assets',id);if(value)plan.assets.set(id,value);}
  if(section.href)await destination(plan,section.href);
  if(section.richText){for(const reference of proseReferences(section.richText))await destination(plan,researchReference(reference));await richLinks(plan,section.richText);}
 }
 for(const [id,original] of plan.originals){
  const row=plan.values.records.get(id);
  for(const reference of [...(row.relations??[]).map(link=>link.target),...(row.references??[]),...proseReferences(original.body),...original.sections.flatMap(section=>proseReferences(section.body))])if(reference)await destination(plan,researchReference(reference));
  if(row.historical)await destination(plan,researchReference({kind:'record',workspaceId:row.sourceWorkspaceId??metadata.id,id:row.recordId??row.id}));
  for await(const note of input.items('availability',{recordId:id}))plan.availability.push(note);
 }
 const scopes=new Set([...plan.groups.flatMap(group=>group.sections.map(section=>(group.region&&group.region!=='layout'?'region:'+resolveRegion(metadata.website,regionTarget,group.region).id:target)+'#'+section.id)),...[...plan.originals.keys()].map(id=>'entry:'+id),...[...plan.cards.keys()].map(id=>'cover:'+id)]);
 for await(const value of input.presentationMedia({scopes})){plan.presentation.set(value.scope+'#'+value.id,value);if(value.link)await destination(plan,value.link);}
 const projected=materialize(plan);plan.groups=plan.groups.map(group=>({...group,sections:publicSections(group.sections,projected.selection,{region:group.region})}));
 const admitted=new Set(plan.groups.flatMap(group=>group.sections.map(section=>publicationCollectionKey(section,group.region))));plan.collections=plan.collections.filter(value=>admitted.has(value.key));
 return plan;
}

export async function publicationInputContext(input,base,{bodyWindow=null,referenceWindow=null,browsePage=null,signal=base.signal}={}){
 const plan={...base,values:Object.fromEntries(Object.entries(base.values).map(([key,value])=>[key,new Map(value)])),cards:new Map(base.cards),covers:new Map(base.covers),branding:new Map(base.branding),presentation:new Map(base.presentation),links:new Map(base.links),references:new Map(base.references)};
 if(bodyWindow){
  for(const row of bodyWindow.records)await loadCard(plan,'records',row);
  for await(const value of input.presentationMedia({scopes:bodyWindow.records.map(row=>'cover:'+row.id)})){plan.presentation.set(value.scope+'#'+value.id,value);if(value.link)await destination(plan,value.link);}
 }
 const {metadata,selection}=materialize(plan),destinations=[...plan.values.records.values()];
 const recordResolver=target=>plan.references.get(researchReference(target))??null;
 const collectionResolver=recordResolver;
 const referenceResolver=href=>{const ref=parseResearchReference(href);return ref?plan.links.get(researchReference(ref))??null:href;};
 const total=await input.recordCount({historical:false}),notebooks={};for(const notebook of metadata.notebooks)notebooks[notebook.id]=await input.recordCount({notebookId:notebook.id});
 const context=projectPublication(metadata,selection,{publicationTarget:base.target,entryDestinations:destinations,publicationCounts:{total,notebooks},referenceResolver,recordResolver,collectionResolver,
  ...(bodyWindow?{collectionPages:[{key:'body',recordIds:bodyWindow.records.map(row=>row.id),staticPage:bodyWindow.staticPage}]}:{}),
  edition:{version:1,records:destinations.flatMap(row=>row.selection?[{...row.selection,id:row.id}]:[]),availability:plan.availability}});
 if(referenceWindow){context.recordJourneys=referenceWindow.rows;context.referencePage={recordIds:referenceWindow.rows.map(row=>row.id),staticPage:{page:referenceWindow.page,total:referenceWindow.total}};}
 if(base.target.startsWith('entry:')){const id=base.target.slice(6),neighbours=await input.neighbours(id);context.recordNeighbours=[neighbours[0],base.values.records.get(id),neighbours[1]].filter(Boolean);}
 if(browsePage){context.browseRecords=browsePage.rows;context.browsePage={staticPage:true};}
 context.publicationStart=await publicationInputStart(input);signal?.throwIfAborted();return {context,plan};
}
export async function publicationInputStart(input){const metadata=await input.metadata();if(hasHomepage(metadata))return 'index.html';for(const kind of ['projects','pages'])for await(const value of input.items(kind,{shared:true}))return kind+'/'+value.id+'.html';return null;}

// Reused by capture finalization for exact media counting. Collection covers
// and project logos stream separately from the target-local projection.
export async function* publicationPlanMedia(input,plan,{signal=plan.signal}={}){
 const {context}=await publicationInputContext(input,plan,{signal});for(const [id,kind] of publicationPage(context,plan.target).media)yield {id,kind};
 for(const collection of plan.collections)for await(const value of publicationCollectionItems(input,collection.section,{signal})){
  if(collection.section.kind==='records'){const cover=await input.get('covers',value.id),image=cover?value.attachments.find(item=>item.id===cover.attachmentId&&item.kind==='image'):value.attachments.find(item=>item.kind==='image');if(image)yield {id:image.id,kind:image.kind};}
  else if(collection.section.kind==='projects'){
   const override=await input.get('branding','project:'+value.id),logos=override?.logos??(value.logoId?[{id:value.logoId}]:[]);for(const logo of logos)yield {id:logo.id,kind:'image'};
  }
 }
 if(plan.layout?.placement!=='replace'&&/^(project|notebook):/.test(plan.target)){
  const [kind,id]=plan.target.split(':');for await(const row of input.records({[kind+'Id']:id,historical:false})){
   signal?.throwIfAborted();const cover=await input.get('covers',row.id),image=cover?row.attachments.find(item=>item.id===cover.attachmentId&&item.kind==='image'):row.attachments.find(item=>item.kind==='image');if(image)yield {id:image.id,kind:image.kind};
  }
 }
}
