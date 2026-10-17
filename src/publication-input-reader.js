import {createHash} from 'node:crypto';
import {validateEditionRecord} from './publication-selection.js';
import {validWebsitePage,validWebsiteAsset,validWebsiteNavigationItem} from './web/website-item-validation.js';
// One adapter for retained publication documents and older inline editions.
// Native readers select values from immutable keyed collections; placeholders
// in the metadata header never mean that a collection is empty.
import {PublicationDocument,PublicationDocumentBuilder} from './publication-document.js';
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {researchId} from './web/research-reference.js';
import {readingKey} from './record-reading-index.js';
import {recordRevision} from './research.js';
import {selectEditionRecord} from './web/publication-selection.js';
import {publicationPageRecord} from './publication-owner-projection.js';
import {readPublicationPage} from './publication-input-pages.js';
import {readPublicationLayout,readPublicationBranding} from './publication-input-presentation.js';
import {publicationRecordDestination,publicationCollectionDestination} from './publication-prose.js';
import {hasHomepage} from './web/website-layouts.js';
import {selectedContent} from './web/website-model.js';
import {publicationDescriptor} from './publication-record-descriptor.js';
const fail=()=>{throw new AppError('JOB_DAMAGED');};
const ordinal=value=>String(value).padStart(16,'0');
const runtime=new WeakMap();
export const PUBLICATION_INPUT_COLLECTIONS=Object.freeze(Object.fromEntries(Object.entries({
 projects:['title'],notebooks:['project','projectTitle','included','title'],pages:['shared','title'],navigation:[],assets:['kind'],
 records:['date','currentDate','scopeDate','scopeCurrentDate','projectDate','projectCurrentDate','scopePosition','original'],
 pageInputs:[],layoutInputs:[],brandingInputs:[],retainedMedia:[],availability:['record'],sourceMaterials:['owner'],sourceGroups:[],legacyPages:[],analysisItems:['owner'],referenceReviews:[],aliases:['target'],identities:[],
 covers:[],presentationMedia:['scope'],targets:['kind'],menu:['parent'],backlinks:['target'],recordPositions:[],linkedCards:[],media:[],fileIds:[],reservedIds:[]
}).map(([name,indexes])=>[name,Object.freeze({indexes:Object.freeze(indexes)})])));
export function compactPublicationMetadata(metadata){
 return {...metadata,projects:[],notebooks:[],pages:[],branding:[],website:{...metadata.website,navigation:[],assets:[],layouts:[],presentation:{...metadata.website.presentation,media:[],covers:[]}}};
}
export function createPublicationInput(workspace,id,metadata,{signal}={}){
 const owner={kind:'source',workspaceId:metadata.id,websiteId:workspace.websiteId??null,jobId:id,attemptId:null};
 const builder=new PublicationDocumentBuilder(workspace,{owner,collections:PUBLICATION_INPUT_COLLECTIONS,signal}),input={metadata:{id:metadata.id,formatVersion:metadata.formatVersion}};
 runtime.set(input,{workspace,builder,header:{metadata:compactPublicationMetadata(metadata)},id,signal});return input;
}
export function publicationInputState(input){const state=runtime.get(input);if(!state)throw new AppError('INVALID');return state;}
export async function finishPublicationInput(input,fields,{signal}={}){
 const state=publicationInputState(input);Object.assign(state.header,fields);const document=await state.builder.finish({header:state.header,signal});
 return {...input,document,...fields};
}
export function publicationRecordIndexes(row,position,projectId){
 const date=readingKey(row,'date'),indexes={date,scopeDate:row.notebookId+'/'+date,scopePosition:row.notebookId+'/'+ordinal(position),original:(row.sourceWorkspaceId??'local')+'/'+(row.recordId??row.id)+'/'+row.revision};
 if(projectId)indexes.projectDate=projectId+'/'+date;
 if(!row.historical){indexes.currentDate=date;indexes.scopeCurrentDate=indexes.scopeDate;if(projectId)indexes.projectCurrentDate=indexes.projectDate;}
 return indexes;
}
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const natural=value=>Number.isSafeInteger(value)&&value>=0;
function recordQuery({notebookId,projectId,historical,order='date',reverse=false}={}){
 if(order==='original')return notebookId?{index:'scopePosition',prefix:notebookId+'/',reverse}:{index:null,reverse};
 if(order!=='date')throw new AppError('INVALID');
 const current=historical===false;
 return {index:notebookId?current?'scopeCurrentDate':'scopeDate':projectId?current?'projectCurrentDate':'projectDate':current?'currentDate':'date',prefix:notebookId?notebookId+'/':projectId?projectId+'/':'',reverse};
}
export async function openPublicationInput(workspace,source,{signal}={}){
 const active=runtime.get(source);if(active)return new PublicationInput(workspace,source,active.builder,active.header,{signal});
 if(source?.version===6||source?.document){
  const document=await PublicationDocument.open(workspace,source.document,{owner:{kind:'source',workspaceId:source.metadata?.id??source.workspaceId,websiteId:source.websiteId??workspace.websiteId??null,jobId:source.id??source.document?.owner.jobId,attemptId:null},signal}),header=await document.header({signal});
  if(!header?.metadata||header.metadata.id!==(source.metadata?.id??source.workspaceId)||document.collectionNames().sort().join()!==Object.keys(PUBLICATION_INPUT_COLLECTIONS).sort().join())fail();
  for(const [name,schema] of Object.entries(PUBLICATION_INPUT_COLLECTIONS))if(Object.keys(document.collection(name).indexes).sort().join()!==[...schema.indexes].sort().join())fail();
  const m=header.metadata;if(['projects','notebooks','pages','branding'].some(name=>!Array.isArray(m[name])||m[name].length)||['navigation','assets','layouts'].some(name=>!Array.isArray(m.website?.[name])||m.website[name].length)||['media','covers'].some(name=>!Array.isArray(m.website?.presentation?.[name])||m.website.presentation[name].length))fail();
  for(const key of ['summary','researchReview','hasSources']){if(Object.hasOwn(source,key)){if(serialize(source[key])!==serialize(header[key]))fail();}else if(source.reviewId!==undefined)fail();}
  if(source.metadata?.formatVersion!==undefined&&source.metadata.formatVersion!==header.metadata.formatVersion)fail();
  const summary=header.summary,review=header.researchReview;
  if(!summary||!review||!review.analysis||!hash(review.analysis.fingerprint)||!natural(review.analysis.count)||review.analysis.count!==document.count('analysisItems')||!review.references||!natural(review.references.count)||review.references.records!==document.count('referenceReviews')||['retainedFigures','changedInputs','editedFigures'].some(key=>!natural(review[key]))||typeof header.hasSources!=='boolean'||header.hasSources!==(document.count('sourceGroups')>1)||!document.count('sourceGroups')||document.count('sourceGroups')>101)fail();
  if(summary.projects!==document.count('projects')||summary.notebooks!==(document.collection('notebooks').indexes.included?.count??0)||summary.records!==document.count('records')||summary.pages!==(document.collection('pages').indexes.shared?.count??0)+document.count('legacyPages')||summary.media!==document.count('media')||document.count('pageInputs')!==(document.collection('pages').indexes.shared?.count??0))fail();
  return new PublicationInput(workspace,source,document,header,{signal});
 }
 if(![1,2,3,4,5].includes(source?.version))fail();return new PublicationInput(workspace,source,null,{metadata:source.version===1?source.book:source.metadata},{signal});
}
class PublicationInput{
 constructor(workspace,source,document,header,{signal}={}){this.workspace=workspace;this.source=source;this.document=document;this.header=header;this.signal=signal;this.id=source.id??document?.blocks.owner.jobId;this.native=!!document;}
 check(){this.signal?.throwIfAborted();}
 async metadata(){this.check();return compactPublicationMetadata(this.header.metadata);}
 async fullHeader(){this.check();return structuredClone(this.header);}
 legacy(name){
  const source=this.source,m=this.header.metadata;
  if(['projects','notebooks','pages','branding'].includes(name))return m[name]??[];
  if(['navigation','assets','layouts'].includes(name))return m.website?.[name]??[];
  if(name==='covers')return m.website?.presentation?.covers??[];if(name==='presentationMedia')return m.website?.presentation?.media??[];
  if(name==='records')return source.records??selectedContent(source.book).entries.map(row=>publicationDescriptor(row,m));
  if(name==='sourceGroups')return source.sourceGroups??[{workspaceId:m.id,materials:source.sourceMaterials??[],analysis:source.researchReview?.analysis??{fingerprint:null,items:[]}}];
  if(name==='analysisItems')return source.researchReview?.analysis?.items??[];if(name==='referenceReviews')return source.researchReview?.references?.items??[];
  return source[name]??[];
 }
 key(name,value,position){return ['layouts','branding','layoutInputs','brandingInputs','navigation'].includes(name)?value.target:name==='covers'?value.entryId:name==='presentationMedia'?value.scope+'/'+value.id:name==='sourceGroups'?value.workspaceId:name==='availability'?value.recordId+':'+serialize(value.target):value.id??ordinal(position);}
 async get(name,key){
  this.check();
  if(['layouts','branding'].includes(name)){
   if(!this.native)return (name==='layouts'?readPublicationLayout:readPublicationBranding)(this.workspace,this.source,key,{signal:this.signal});
   const ref=await this.document.get(name==='layouts'?'layoutInputs':'brandingInputs',key,{signal:this.signal});if(!ref)return null;
   const source={version:5,id:this.id,metadata:{formatVersion:this.header.metadata.formatVersion},[name==='layouts'?'layoutInputs':'brandingInputs']:[ref]};
   return (name==='layouts'?readPublicationLayout:readPublicationBranding)(this.workspace,source,key,{signal:this.signal});
  }
  const value=this.native?await this.document.get(name,key,{signal:this.signal}):this.legacy(name).find((row,position)=>this.key(name,row,position)===key)??null;
  if(name==='pages'&&value?.share){const ref=this.native?await this.document.get('pageInputs',key,{signal:this.signal}):this.legacy('pageInputs').find(row=>row.id===key);if(ref)return {...value,excerpt:ref.excerpt,hasBody:ref.hasBody};}
  return value;
 }
 async count(name,options={}){
  this.check();if(name==='records')return this.recordCount(options);
  if(!this.native){let total=0;for await(const row of this.items(name,options)){void row;total++;}return total;}
  const query=this.collectionQuery(name,options);
  if(query.index!==undefined&&query.index!==null||query.prefix)return (await this.document.window(name,{...query,limit:1,signal:this.signal})).total;
  return this.document.count(name);
 }
 collectionQuery(name,options={}){
  const query={...options};delete query.projectId;delete query.recordId;delete query.shared;
  if(name==='availability'&&options.recordId){query.index='record';query.prefix=options.recordId+'/';}
  if(name==='notebooks'&&options.projectId){query.index=options.index==='title'?'projectTitle':'project';query.prefix=options.projectId+'/';}
  else if(name==='notebooks'&&!query.index){query.index='included';query.prefix='yes/';}
  if(name==='pages'&&options.shared!==false&&!query.index){query.index='shared';query.prefix='yes/';}
  return query;
 }
 async *items(name,options={}){
  this.check();if(name==='records'){yield* this.records(options);return;}
  if(['layouts','branding'].includes(name)){if(!this.native&&this.source.version<5){yield* this.legacy(name);return;}for await(const row of this.items(name==='layouts'?'layoutInputs':'brandingInputs',options))yield await this.get(name,row.target);return;}
  if(this.native){for await(const {value} of this.document.items(name,{...this.collectionQuery(name,options),signal:this.signal})){this.check();yield name==='pages'?await this.get(name,value.id):value;}return;}
  let values=this.legacy(name);
  if(name==='projects')values=values.filter(row=>row.share);
  if(name==='notebooks'){const records=this.legacy('records'),projects=this.legacy('projects');values=values.filter(row=>projects.some(p=>p.id===row.projectId&&p.share)&&records.some(r=>r.notebookId===row.id));}
  if(name==='pages'&&options.shared!==false)values=values.filter(row=>row.share);
  if(options.projectId)values=values.filter(row=>row.projectId===options.projectId);
  if(options.recordId)values=values.filter(row=>row.recordId===options.recordId);
  if(options.index==='title')values=[...values].sort((a,b)=>a.title.localeCompare(b.title,'en')||(a.id<b.id?-1:a.id>b.id?1:0));
  if(options.reverse)values=[...values].reverse();
  for(const row of values.slice(options.offset??0)){this.check();yield row;}
 }
 async window(name,{offset=0,limit=32,cursor=null,...options}={}){
  if(this.native){const result=await this.document.window(name,{...this.collectionQuery(name,options),offset,limit,cursor,signal:this.signal});const items=[];for(const row of result.items)items.push(name==='pages'?await this.get(name,row.value.id):row.value);return {...result,items};}
  if(cursor!==null)offset=Number(cursor);const items=[];let at=0,total=0;
  for await(const row of this.items(name,options)){if(at++>=offset&&items.length<limit)items.push(row);total++;}return {items,total,offset,next:offset+items.length<total?String(offset+items.length):null};
 }
 async record(id){
  const row=await this.get('records',id);if(!row)throw new AppError('NOT_FOUND');let record;
  if(this.source.version===1)record=this.source.book.entries.find(record=>record.id===(row.recordId??row.id));
  else{const raw=await this.workspace.readMetadata('.observanda/release-inputs/'+this.id+'/'+row.id+'.json',4*1024*1024);this.check();if(raw===null||digest(raw)!==row.sha256)fail();try{record=JSON.parse(raw);}catch{fail();}}
  if(!record||record.id!==(row.recordId??row.id)||recordRevision(record)!==row.revision)fail();if(row.selection){try{validateEditionRecord(record,row.selection);}catch{fail();}}return publicationPageRecord(selectEditionRecord(record,row.selection),row);
 }
 async *records(options={}){
  this.check();if(!this.native){let rows=this.legacy('records').filter(row=>(!options.notebookId||row.notebookId===options.notebookId)&&(!options.projectId||this.legacy('notebooks').some(book=>book.id===row.notebookId&&book.projectId===options.projectId))&&(options.historical===undefined||!!row.historical===options.historical));if(options.order!=='original')rows=[...rows].sort((a,b)=>readingKey(a,'date').localeCompare(readingKey(b,'date'),'en'));if(options.reverse)rows=[...rows].reverse();if(options.after){const index=rows.findIndex(row=>row.id===options.after);if(index>=0)rows=rows.slice(index+1);}for(const row of rows){this.check();yield row;}return;}
  const query=recordQuery(options);let offset=options.offset??0;
  if(options.after){const at=await this.document.position('records',options.after,{...query,signal:this.signal});if(at===null)throw new AppError('INVALID');offset=at+1;}
  for await(const {value} of this.document.items('records',{...query,offset,signal:this.signal}))if((options.historical===undefined||!!value.historical===options.historical)&&(!options.projectId||options.order!=='original'||(await this.get('notebooks',value.notebookId))?.projectId===options.projectId))yield value;
 }
 async recordCount(options={}){
  if(!this.native){let count=0;for await(const row of this.records(options)){void row;count++;}return count;}
  if(options.historical===true)return await this.recordCount({...options,historical:undefined})-await this.recordCount({...options,historical:false});
  const query=recordQuery({...options,order:'date'});return (await this.document.window('records',{...query,limit:1,signal:this.signal})).total;
 }
 async neighbours(id){
  const row=await this.get('records',id);if(!row)return [null,null];
  if(!this.native){const values=[];for await(const value of this.records({notebookId:row.notebookId,order:'original'}))values.push(value);const at=values.findIndex(value=>value.id===id);return [values[at-1]??null,values[at+1]??null];}
  const query={index:'scopePosition',prefix:row.notebookId+'/',signal:this.signal},position=await this.document.position('records',id,query);if(position===null)fail();
  const previous=position?await this.document.window('records',{...query,offset:position-1,limit:1}):null,next=await this.document.window('records',{...query,offset:position+1,limit:1});return [previous?.items[0]?.value??null,next.items[0]?.value??null];
 }
 async destination(target,kind){
  if(!this.native)return kind==='record'?publicationRecordDestination(this.legacy('records'),target,this.header.metadata.id):publicationCollectionDestination({projects:this.legacy('projects'),notebooks:this.legacy('notebooks')},target,this.header.metadata.id);
  let exact=false,exactBest=null,aliasBest=null,aliasOwner=null,ambiguous=false;const collection={record:'records',project:'projects',notebook:'notebooks'}[kind];if(!collection)return null;
  const better=(before,row)=>!before||target.revision&&row.historical&&!before.historical?row:before;
  for await(const {value} of this.document.items('aliases',{index:'target',prefix:target.workspaceId+'/'+kind+'/'+target.id+'/',signal:this.signal})){
   const row=await this.document.get(collection,value.publicId,{signal:this.signal});if(!row)fail();const own=value.owner===target.workspaceId;
   if(own)exact=true;else if(aliasOwner===null)aliasOwner=value.owner;else if(aliasOwner!==value.owner)ambiguous=true;
   if(target.revision?row.revision!==target.revision:kind==='record'&&row.historical)continue;
   if(own)exactBest=better(exactBest,row);else aliasBest=better(aliasBest,row);
  }
  return exact?exactBest:ambiguous?null:aliasBest;
 }
 recordTarget(target){return this.destination(target,'record');}
 collectionTarget(target){return this.destination(target,target.kind);}
 async page(id){
  const label=await this.get('pages',id);if(!label||!label.share)throw new AppError('NOT_FOUND');
  if(!this.native)return readPublicationPage(this.workspace,this.source,id,{signal:this.signal});
  const ref=await this.document.get('pageInputs',id,{signal:this.signal});if(!ref)fail();const {excerpt,hasBody,...rawLabel}=label;void excerpt;void hasBody;
  return readPublicationPage(this.workspace,{version:4,id:this.id,metadata:{id:this.header.metadata.id,formatVersion:this.header.metadata.formatVersion,pages:[rawLabel]},pageInputs:[ref]},id,{signal:this.signal});
 }
 pages(options){return this.items('pages',options);}
 project(id){return this.get('projects',id);}
 notebook(id){return this.get('notebooks',id);}
 async target(target){
  if(this.native){const value=await this.document.get('targets',target,{signal:this.signal});if(!value)return null;const collection={entry:'records',page:'pages',project:'projects',notebook:'notebooks'}[value.kind];return collection?{...await this.get(collection,value.id),...value}:value;}
  if(target==='home')return hasHomepage(this.header.metadata)?{target,title:'Home',path:'index.html',kind:'home',id:null}:null;
  const [kind,id]=target.split(':'),name={project:'projects',notebook:'notebooks',page:'pages',entry:'records'}[kind];if(!name)return null;
  for await(const row of this.items(name))if(row.id===id)return {...row,target,title:row.title,path:(name==='records'?'entries':name)+'/'+id+'.html',kind,id};return null;
 }
 async *navigation({parent}={}){
  if(this.native){for await(const {value} of this.document.items('menu',{...(parent!==undefined?{index:'parent',prefix:(parent??'root')+'/'}:{}),signal:this.signal}))yield value;return;}
  const targets=[];if(hasHomepage(this.header.metadata))targets.push(await this.target('home'));for(const name of ['projects','notebooks','pages'])for await(const row of this.items(name))targets.push(await this.target(({projects:'project',notebooks:'notebook',pages:'page'}[name])+':'+row.id));
  const settings=this.legacy('navigation'),values=[...settings.map(setting=>{const target=targets.find(t=>t.target===setting.target);return target&&setting.show?{...target,title:setting.label||target.title,parent:setting.parent??null}:null;}).filter(Boolean),...targets.filter(target=>!settings.some(setting=>setting.target===target.target)&&target.kind!=='notebook').map(target=>({...target,parent:null}))];
  for(const value of values){if(!values.some(row=>row.target===value.parent))value.parent=null;if(parent===undefined||value.parent===parent)yield value;}
 }
 async references(id,{offset=0,limit=24}={}){
  if(!this.native){const rows=[];for(const row of this.legacy('records')){const relations=[];for(const relation of row.relations??[]){if(relation.target.kind==='record'&&(await this.recordTarget(relation.target))?.id===id)relations.push({role:relation.role??'related',id});}if(relations.length)rows.push({...row,relations});}return {rows:rows.slice(offset,offset+limit),total:rows.length,next:offset+limit<rows.length?offset+limit:null};}
  const page=await this.document.window('backlinks',{index:'target',prefix:id+'/',offset,limit,signal:this.signal}),rows=[];
  for(const {value} of page.items){const row=await this.get('records',value.recordId);if(!row)fail();rows.push({...row,relations:value.relations});}return {rows,total:page.total,next:offset+rows.length<page.total?offset+rows.length:null};
 }
 async *presentationMedia({scopes}={}){
  if(!this.native){for(const row of this.legacy('presentationMedia'))if(!scopes||new Set(scopes).has(row.scope))yield row;return;}
  if(!scopes){yield* this.items('presentationMedia');return;}
  for(const scope of new Set(scopes))for await(const {value} of this.document.items('presentationMedia',{index:'scope',prefix:scope+'/',signal:this.signal}))yield value;
 }
 sourceGroups(){return this.items('sourceGroups');}
 async *sourceMaterials({workspaceId}={}){
  if(!this.native){for(const group of this.legacy('sourceGroups'))if(workspaceId===undefined||group.workspaceId===workspaceId)yield* group.materials;return;}
  for await(const {value} of this.document.items('sourceMaterials',{...(workspaceId?{index:'owner',prefix:workspaceId+'/'}:{}),signal:this.signal}))yield value.source;
 }
 async verify(){
  if(!this.native)return;
  // Reopen both collection roots and originals. A previous selected read must
  // never hide subsequent corruption behind its immutable-node cache.
  const fresh=await openPublicationInput(this.workspace,this.source,{signal:this.signal}),document=fresh.document,metadata=await fresh.metadata();
  let groupPosition=0,groupCount=0,analysisCount=0,referenceCount=0,retainedFigures=0,hostFingerprint=null;const groupHash=createHash('sha256');groupHash.update('[');
  const claim=async(fileId,kind,key)=>{
   if(!researchId(fileId))fail();const value=await document.get('fileIds',fileId,{signal:this.signal});
   if(!value||value.kind!==kind||value.key!==key||kind!=='record'&&await document.get('reservedIds',fileId,{signal:this.signal}))fail();
  };
  const index=async(name,key,indexName,prefix,expected=true)=>{const at=await document.position(name,key,{index:indexName,prefix,signal:this.signal});if((at!==null)!==expected)fail();};
  const result=await document.verify({signal:this.signal,onItem:async(name,{key,value})=>{
   if(name==='records'){
    if(!researchId(value.id)||value.id!==key||!hash(value.sha256)||!hash(value.revision)||!researchId(value.notebookId)||!researchId(value.recordId)||!researchId(value.sourceWorkspaceId))fail();
    const notebook=await document.get('notebooks',value.notebookId,{signal:this.signal}),position=await document.get('recordPositions',key,{signal:this.signal});
    if(!notebook||!position||!natural(position.position)||position.position!==await document.position('records',key,{signal:this.signal}))fail();
    await claim(key,'record',key);const selected=await fresh.record(key);
    if(value.title!==selected.title||value.notebookId!==selected.notebookId||serialize(value.media)!==serialize(selected.attachments.filter(row=>row.share).map(({id,kind})=>({id,kind,share:true}))))fail();
    for(const [indexName,prefix] of Object.entries(publicationRecordIndexes(value,position.position,notebook.projectId)))await index(name,key,indexName,prefix);
    if(value.historical){await index(name,key,'currentDate','',false);await index(name,key,'scopeCurrentDate','',false);await index(name,key,'projectCurrentDate','',false);}
    const group=await document.get('sourceGroups',value.sourceWorkspaceId,{signal:this.signal});if(!group)fail();
    for(const media of value.media??[])if(value.sourceWorkspaceId!==metadata.id&&!await document.get('retainedMedia',media.id,{signal:this.signal}))fail();
   }
   if(name==='projects'){if(value.id!==key||!researchId(key)||value.share!==true)fail();await index(name,key,'title','');}
   if(name==='notebooks'){
    if(value.id!==key||!researchId(key)||!await document.get('projects',value.projectId,{signal:this.signal}))fail();const included=await fresh.recordCount({notebookId:key})>0;
    await index(name,key,'included','yes/',included);await index(name,key,'project',value.projectId+'/',included);await index(name,key,'projectTitle',value.projectId+'/',included);await index(name,key,'title','',included);
   }
   if(name==='pages'){
    if(value.id!==key||!validWebsitePage(value,{formatVersion:metadata.formatVersion})||value.body!==''||!Array.isArray(value.sections)||value.sections.length)fail();
    const ref=await document.get('pageInputs',key,{signal:this.signal});if(!!ref!==value.share)fail();await index(name,key,'shared','yes/',value.share);await index(name,key,'title','',value.share);
   }
   if(name==='pageInputs'){if(value.id!==key)fail();await claim(value.fileId,name,key);await fresh.page(key);}
   if(name==='layoutInputs'||name==='brandingInputs'){if(value.target!==key)fail();await claim(value.fileId,name,key);await fresh.get(name==='layoutInputs'?'layouts':'branding',key);}
   if(name==='assets'){if(value.id!==key||!validWebsiteAsset(value))fail();await index(name,key,'kind',value.kind+'/');}
   if(name==='navigation'){if(value.target!==key||!validWebsiteNavigationItem(value,{formatVersion:metadata.formatVersion}))fail();}
   if(name==='fileIds'){
    if(value.kind==='record'){if(value.key!==key||!await document.get('records',key,{signal:this.signal}))fail();}
    else if(['pageInputs','layoutInputs','brandingInputs'].includes(value.kind)){if((await document.get(value.kind,value.key,{signal:this.signal}))?.fileId!==key)fail();}else fail();
   }
   if(name==='sourceGroups'){
    if(value.workspaceId!==key||!researchId(key)||!hash(value.analysis?.fingerprint)||!natural(value.analysis?.count)||(!groupPosition?key!==metadata.id||value.snapshotId!==null:!hash(value.snapshotId)))fail();
    if(groupPosition++)groupHash.update(',');groupHash.update(JSON.stringify([key,value.analysis.fingerprint]));groupCount++;analysisCount+=value.analysis.count;hostFingerprint??=value.analysis.fingerprint;
    if((await document.window('analysisItems',{index:'owner',prefix:key+'/',limit:1,signal:this.signal})).total!==value.analysis.count)fail();
   }
   if(name==='sourceMaterials'){
    if(!researchId(value.workspaceId)||!value.source||!await document.get('sourceGroups',value.workspaceId,{signal:this.signal}))fail();if(value.source.figureId)retainedFigures++;await index(name,key,'owner',value.workspaceId+'/');
   }
   if(name==='analysisItems'){if(value.id!==key||!hash(key)||!researchId(value.recordId)||!await document.get('records',value.recordId,{signal:this.signal}))fail();}
   if(name==='referenceReviews'){if(value.recordId!==key||!natural(value.count)||!value.count||!await document.get('records',key,{signal:this.signal}))fail();referenceCount+=value.count;}
   if(name==='aliases'){
    const collection={record:'records',project:'projects',notebook:'notebooks'}[value.kind];if(!collection||key!==value.namespace+'/'+value.kind+'/'+value.sourceId+'/'+value.publicId)fail();
    const row=await document.get(collection,value.publicId,{signal:this.signal});if(!row||(value.kind==='record'?row.recordId:row.sourceId)!==value.sourceId||(row.sourceWorkspaceId??metadata.id)!==value.owner||!(row.referenceNamespaces??[]).includes(value.namespace))fail();await index(name,key,'target',value.namespace+'/'+value.kind+'/'+value.sourceId+'/');
   }
   if(name==='targets'){
    if(value.target!==key)fail();if(value.kind==='home'){if(key!=='home'||value.id!==null||!hasHomepage(metadata)||value.path!=='index.html')fail();}
    else{const collection={entry:'records',project:'projects',notebook:'notebooks',page:'pages'}[value.kind],row=collection&&await document.get(collection,value.id,{signal:this.signal});if(!row||key!==value.kind+':'+row.id||value.title!==row.title||value.path!==(value.kind==='entry'?'entries':collection)+'/'+row.id+'.html'||value.kind==='page'&&!row.share||value.kind==='notebook'&&!await fresh.recordCount({notebookId:row.id}))fail();}await index(name,key,'kind',value.kind+'/');
   }
   if(name==='menu'){
    const target=await fresh.target(key),setting=await document.get('navigation',key,{signal:this.signal});if(!target||value.target!==key||value.path!==target.path||setting&&!setting.show||!setting&&target.kind==='notebook'||value.title!==(setting?.label||target.title))fail();
    const parent=setting?.parent&&await document.get('menu',setting.parent,{signal:this.signal})?setting.parent:null;if(value.parent!==parent)fail();await index(name,key,'parent',(parent??'root')+'/');
   }
   if(name==='backlinks'){
    const target=key.split('/')[0];if(key!==target+'/'+value.recordId||!await document.get('records',target,{signal:this.signal})||!await document.get('records',value.recordId,{signal:this.signal})||!Array.isArray(value.relations)||!value.relations.length||value.relations.some(row=>row.id!==target||typeof row.role!=='string'))fail();await index(name,key,'target',target+'/');
   }
  }});
  groupHash.update(']');const header=fresh.header;
  if(header.hasSources!==(groupCount>1)||header.researchReview.analysis.count!==analysisCount||header.researchReview.analysis.fingerprint!==(header.hasSources?groupHash.digest('hex'):hostFingerprint)||header.researchReview.references.count!==referenceCount||header.researchReview.retainedFigures!==retainedFigures)fail();
  const expectedTargets=(hasHomepage(metadata)?1:0)+header.summary.projects+header.summary.notebooks+header.summary.records+(document.collection('pages').indexes.shared?.count??0);
  if(document.count('targets')!==expectedTargets||document.count('fileIds')!==document.count('records')+document.count('pageInputs')+document.count('layoutInputs')+document.count('brandingInputs'))fail();
  const {publicationInputMedia}=await import('./publication-input-media.js'),media=document.count('retainedMedia')?publicationInputMedia(this.workspace,this.source):null;
  for await(const {value} of document.items('retainedMedia',{signal:this.signal})){this.check();const asset=await media.get(value.id,{streamed:true,signal:this.signal});await asset.bytes.verify();}
  return result;
 }
}
