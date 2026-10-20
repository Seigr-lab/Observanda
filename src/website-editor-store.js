import {reviewWebsiteTemplate,changeWebsiteTemplate,assertWebsiteTemplateDefinitions,validateWebsiteTemplateBinding,assertUnchangedWebsiteTemplateLinks,assertNewWebsiteTemplateTarget} from './website-template-inheritance.js';
import {applyWebsiteTheme} from './website-theme-exchange.js';
import {readWebsiteSources,changeWebsiteSources,websiteSourceCommandLookup} from './website-source-commands.js';
import {websiteSourceSummary} from './website-source-selections.js';
import {requireWebsiteSourceSelections} from './catalogue-format.js';
// Durable selected website edits retain complete immutable roots. Transport
// projections omit growing owners; no caller can supply a replacement root.
import {randomUUID,createHash} from 'node:crypto';
import {AppError} from './errors.js';
import {digest,serialize} from './storage-format.js';
import {ObjectIndex,validIndexRef} from './object-index.js';
import {RecordDocument} from './record-document.js';
import {retainRecordContainer} from './record-tree-values.js';
import {WebsiteDocumentStore} from './website-document-store.js';
import {WebsiteDocumentBlockStore} from './website-document-block-store.js';
import {WebsiteCollectionIndex,validWebsiteCollectionIndexes} from './website-collection-index.js';
import {WebsiteEditorNavigation,validWebsiteNavigationProjection} from './website-editor-navigation.js';
import {websiteDocumentHeader,validateWebsiteDocumentHeader,validateWebsiteDocumentSelection,validateWebsiteDocument,websiteAssetUsage} from './website-document-validation.js';
import {requireWebsitePresentation,catalogueFormat,catalogueRequiresWebsiteEditor,catalogueRequiresWebsitePresentation} from './catalogue-format.js';
import {researchId} from './web/research-reference.js';
import {revisionId} from './web/revision-model.js';
import {validWebsitePin,sameWebsitePin} from './web/website-pin.js';
import {WEBSITE_COLLECTION_PATHS,websiteCollectionName,websiteCollectionKey,validWebsiteCollectionKey,validWebsiteEditorOperation,validWebsitePage,validWebsiteNavigationItem,validWebsiteAsset,validWebsiteLayout,validWebsiteBranding} from './web/website-collection-model.js';
import {SnapshotIndex} from './snapshot-index.js';
import {defaultWebsiteSelection} from './website-owned-metadata.js';
import {withScratch} from './scratch-work.js';
import {emptyHomepage} from './web/website-model.js';
import {websiteBook} from './web/website-sites-model.js';
import {publicationPresentationTarget} from './web/publication-presentation-target.js';
const prefix='website-editor:',hash=value=>digest(serialize(value)),ordinal=n=>String(n).padStart(16,'0');
const invalid=()=>{throw new AppError('INVALID');},damaged=()=>{throw new AppError('CATALOGUE_DAMAGED');},conflict=()=>{throw new AppError('CONFLICT');},notFound=()=>{throw new AppError('NOT_FOUND');};
const natural=value=>Number.isSafeInteger(value)&&value>=0;
const pinOf=value=>({researchSnapshotId:value.researchSnapshotId,websiteId:value.websiteId,websiteRevision:value.websiteRevision});
const validHead=value=>value&&Object.keys(value).sort().join()==='base,generation,history,id,position,tip,version,websiteId,workspaceId'&&value.version===1&&researchId(value.workspaceId)&&researchId(value.websiteId)&&researchId(value.id)&&value.base&&Object.keys(value.base).sort().join()==='researchSnapshotId,websiteRevision'&&revisionId(value.base.researchSnapshotId)&&revisionId(value.base.websiteRevision)&&natural(value.generation)&&natural(value.position)&&natural(value.tip)&&value.position<=value.tip&&value.tip<=value.generation&&validIndexRef(value.history)&&value.history&&value.history.count>=value.tip+1;
const validCheckpoint=value=>value&&Object.keys(value).sort().join()==='collectionIndexes,navigationProjection,root,version'&&[1,2].includes(value.version)&&revisionId(value.root)&&validWebsiteCollectionIndexes(value.collectionIndexes,{version:value.version})&&validWebsiteNavigationProjection(value.navigationProjection);
export class WebsiteEditorStore{
 constructor(store,{sourceReader}={}){this.store=store;this.sourceReader=sourceReader;this.documents=new WebsiteDocumentStore(store);}
 history(id){return new ObjectIndex(this.store,{namespace:prefix+'history:'+id+':',immutable:true});}
 async owner(websiteId){const registry=await this.documents.registry();if(!registry)throw new AppError('ACCESS_UPGRADE');return {registry,id:await this.documents.ownedId(websiteId,registry)};}
 async readSlot(slot){const row=await this.store.db.get('SELECT payload FROM state WHERE slot=$1',slot);return row?this.store.decode('state',slot,row.payload):null;}
 async immutable(slot,value){const previous=await this.readSlot(slot);if(previous!==null){if(hash(previous)!==hash(value))damaged();return;}await this.store.db.run('INSERT INTO state VALUES ($1,$2)',slot,this.store.encode('state',slot,value));}
 async head(id){const value=await this.readSlot(prefix+'head:'+id);if(value!==null&&(!validHead(value)||value.websiteId!==id))damaged();return value;}
 async checkpoint(head,position=head.position){const entry=await this.history(head.websiteId).find({root:head.history},ordinal(position));if(!entry)damaged();const value=await this.readSlot(prefix+'checkpoint:'+head.websiteId+':'+entry.revision);if(!validCheckpoint(value)||hash(value)!==entry.revision||value.version===2&&!catalogueRequiresWebsitePresentation(await catalogueFormat(this.store.db)))damaged();return value;}
 async retainHead(head){if(!validHead(head))damaged();const revision=hash(head);await this.immutable(prefix+'revision:'+head.websiteId+':'+head.id+':'+revision,head);await this.store.db.run('INSERT INTO state VALUES ($1,$2) ON CONFLICT(slot) DO UPDATE SET payload=excluded.payload',prefix+'head:'+head.websiteId,this.store.encode('state',prefix+'head:'+head.websiteId,head));return revision;}
 async retainedHead(id,draftId,revision){if(!researchId(draftId)||!revisionId(revision))invalid();const value=await this.readSlot(prefix+'revision:'+id+':'+draftId+':'+revision);if(!value)notFound();if(!validHead(value)||value.websiteId!==id||value.id!==draftId||hash(value)!==revision)damaged();return value;}
 async context(websiteId,{websitePin,draftId,draftRevision,signal,mutable=false,active=false}={}){
  signal?.throwIfAborted();if(websitePin!==undefined&&websitePin!==null&&(!validWebsitePin(websitePin)||websitePin.websiteId!==websiteId)||draftId==null&&draftRevision!==undefined&&draftRevision!==null)invalid();const registry=await this.documents.registry();
  if(!registry||websitePin?.websiteRevision===null){if(draftId!==undefined&&draftId!==null||mutable)throw new AppError('ACCESS_UPGRADE');const legacy=await this.documents.document(websiteId,{...websitePin,signal});return {websitePin:pinOf(legacy),head:null,checkpoint:{version:1,root:legacy.document.root,collectionIndexes:null,navigationProjection:null},document:legacy.document};}
  const id=await this.documents.ownedId(websiteId,registry);let head;
  if(draftId!==undefined&&draftId!==null){head=await this.retainedHead(id,draftId,draftRevision);if(websitePin&&!sameWebsitePin(websitePin,{websiteId,...head.base}))invalid();}
  else if(active){await this.documents.savedHead(id,registry);head=await this.head(id);}
  if(head){if(head.workspaceId!==registry.workspaceId)damaged();const checkpoint=await this.checkpoint(head),blocks=new WebsiteDocumentBlockStore(this.store,id,{readOnly:!mutable}),document=new RecordDocument(blocks,checkpoint.root,{mutable});if((await document.field(['id'],{signal})).value!==id)damaged();return {websitePin:{websiteId,...head.base},head,checkpoint,document};}
  if(websitePin!==undefined&&websitePin!==null&&(!validWebsitePin(websitePin)||websitePin.websiteId!==websiteId))invalid();
  const value=await this.documents.document(websiteId,{...websitePin,mutable,signal});return {websitePin:pinOf(value),head:null,checkpoint:{version:value.collectionIndexes?.layouts?2:1,root:value.document.root,collectionIndexes:value.collectionIndexes??null,navigationProjection:value.navigationProjection??null},document:value.document};
 }
 async document(websiteId,options={}){const context=await this.context(websiteId,options);return {websitePin:context.websitePin,document:context.document,collectionIndexes:context.checkpoint.collectionIndexes,navigationProjection:context.checkpoint.navigationProjection};}
 async navigation(context,site,{signal}={}){
  const snapshot=await this.store.snapshot(context.websitePin.researchSnapshotId),source=await WebsiteEditorNavigation.source(this.store,snapshot,context.document,site,context.checkpoint.collectionIndexes,{signal}),value=context.checkpoint.navigationProjection;
  return value&&value.signature===source.signature?new WebsiteEditorNavigation(context.document,value):source;
 }
 async envelope(context,{signal}={}){
  const site=await websiteDocumentHeader(context.document,{signal}),collections={},indexes=context.checkpoint.collectionIndexes;
  for(const collection of Object.keys(WEBSITE_COLLECTION_PATHS))collections[collection]={count:indexes?.[collection]?.count??await context.document.tree.arrayLength(context.document.root,WEBSITE_COLLECTION_PATHS[collection])};
  if(indexes)collections.pages.sharedCount=await (await WebsiteCollectionIndex.open(context.document,'pages',indexes.pages,{signal})).sharedCount();
  else{collections.pages.sharedCount=0;for(let i=0;i<collections.pages.count;i++)if((await context.document.field(['document','pages',String(i),'share'],{signal})).value)collections.pages.sharedCount++;}
  const navigation=await this.navigation(context,site,{signal});collections.navigation.count=navigation.value?.count??await navigation.total();
  if(!site.selection)site.selection=await defaultWebsiteSelection(this.store,await this.store.snapshot(context.websitePin.researchSnapshotId),{signal});delete site.document.pages;delete site.document.website.navigation;delete site.document.website.assets;delete site.document.website.layouts;delete site.document.branding;site.id=context.websitePin.websiteId;
  let draft=null;if(context.head){const initial=await this.checkpoint(context.head,0);draft={id:context.head.id,revision:hash(context.head),generation:context.head.generation,dirty:context.document.root!==initial.root,canUndo:context.head.position>0,canRedo:context.head.position<context.head.tip};}
  return {websitePin:context.websitePin,site,collections,draft,sources:await websiteSourceSummary(context.document)};
 }
 async open(websiteId,options={}){return this.envelope(await this.context(websiteId,{...options,active:true}),options);}
 async templateReview(websiteId,{target,decisions={},...options}={}){const context=await this.context(websiteId,options);return {...await reviewWebsiteTemplate(context,target,{...options,decisions}),websitePin:context.websitePin};}
 async sources(websiteId,options={}){const context=await this.context(websiteId,options);return {...await readWebsiteSources(context.document,options),websitePin:context.websitePin};}
 async sourceItem(context,collection,key,{signal}={}){
  if(!websiteCollectionName(collection)||!validWebsiteCollectionKey(collection,key))invalid();const path=WEBSITE_COLLECTION_PATHS[collection],descriptor=context.checkpoint.collectionIndexes?.[collection];let position=null;
  if(descriptor){const index=await WebsiteCollectionIndex.open(context.document,collection,descriptor,{signal});if(!index)damaged();position=(await index.item(key,{signal}))?.position??null;}
  else{const count=await context.document.tree.arrayLength(context.document.root,path);for(let i=0;i<count;i++){signal?.throwIfAborted();if((await context.document.field([...path,String(i),['navigation','layouts','branding'].includes(collection)?'target':'id'],{signal})).value===key){position=i;break;}}}
  if(position===null)return null;const revision=await context.document.reference([...path,String(position)],{signal}),value=(await context.document.field([...path,String(position)],{signal})).value;return {key,position,revision,value};
 }
 async item(websiteId,{collection,key,position,expectedItemRevision,...options}={}){
  const context=await this.context(websiteId,options);let row=await this.sourceItem(context,collection,key,options);
  if(collection==='navigation'){const site=await websiteDocumentHeader(context.document,options),navigation=await this.navigation(context,site,options);if(navigation instanceof WebsiteEditorNavigation)row=await navigation.item(key);else for await(const candidate of navigation.rows())if(candidate.key===key){row=candidate;break;}}
  if(!row)notFound();if(position!==undefined&&position!==row.position||expectedItemRevision!==undefined&&row.revision!==expectedItemRevision)conflict();return {...row,websitePin:context.websitePin};
 }
 async window(websiteId,{collection,offset=0,limit=20,search='',kind=null,...options}={}){
  if(!websiteCollectionName(collection)||!natural(offset)||!Number.isSafeInteger(limit)||limit<1||limit>100||typeof search!=='string'||search.length>200||![null,'all','image','audio','video','file','media'].includes(kind)||collection!=='assets'&&kind!==null&&kind!=='all')invalid();
  const query=search.trim().toLocaleLowerCase();
  if(query||kind!==null&&kind!=='all'){
   const rows=[];let total=0,sourceTotal=Infinity;
   for(let sourceOffset=0;sourceOffset<sourceTotal;sourceOffset+=100){const page=await this.window(websiteId,{collection,offset:sourceOffset,limit:100,...options});sourceTotal=page.total;
    for(const row of page.rows){const value=row.value,matched=(!query||['title','label','caption','alt','name','id','target'].some(name=>typeof value[name]==='string'&&value[name].toLocaleLowerCase().includes(query)))&&(kind===null||kind==='all'||kind==='media'?kind!=='media'||value.kind!=='file':value.kind===kind);if(!matched)continue;if(total>=offset&&rows.length<limit)rows.push(row);total++;}
   }
   const context=await this.context(websiteId,options);return {rows,total,offset,websitePin:context.websitePin};
  }
  const context=await this.context(websiteId,options),rows=[];
  if(collection==='navigation'){const site=await websiteDocumentHeader(context.document,options),navigation=await this.navigation(context,site,options);if(navigation instanceof WebsiteEditorNavigation)return {...await navigation.window({offset,limit,...options}),websitePin:context.websitePin};for await(const row of navigation.rows()){if(row.position>=offset&&rows.length<limit)rows.push(row);if(rows.length===limit)break;}return {rows,total:await navigation.total(),offset,websitePin:context.websitePin};}
  const path=WEBSITE_COLLECTION_PATHS[collection],total=context.checkpoint.collectionIndexes?.[collection]?.count??await context.document.tree.arrayLength(context.document.root,path);
  for(let position=offset;position<Math.min(total,offset+limit);position++){
   options.signal?.throwIfAborted();const revision=await context.document.reference([...path,String(position)],options);let value;
   const labels=collection==='pages'?['id','title','share']:collection==='layouts'?['target','heading']:collection==='branding'?['target']:null;
   if(labels){value={};for(const name of labels)value[name]=(await context.document.field([...path,String(position),name],options)).value;}else value=(await context.document.field([...path,String(position)],options)).value;
   rows.push({key:websiteCollectionKey(collection,value),position,revision,value});
  }
  return {rows,total,offset,websitePin:context.websitePin};
 }
 async receipt(id,commandId,type,args){if(!researchId(commandId))invalid();const slot=prefix+'receipt:'+id+':'+commandId,request=hash({type,...args}),prior=await this.readSlot(slot);if(prior&&(!prior||Object.keys(prior).sort().join()!=='request,result,version'||prior.version!==1))damaged();if(prior&&prior.request!==request)conflict();return {slot,request,prior};}
 async result(websiteId,result,options={}){return this.envelope(await this.context(websiteId,{...options,websitePin:result.websitePin,...(result.draft?{draftId:result.draft.id,draftRevision:result.draft.revision}:{})}),options);}
 async acknowledge(receipt,context,{signal}={}){const result={websitePin:context.websitePin,draft:context.head?{id:context.head.id,revision:hash(context.head)}:null};await this.immutable(receipt.slot,{version:1,request:receipt.request,result});return this.envelope(context,{signal});}
 async editing(websiteId,{draftId=null,expectedRevision=null,websitePin,signal}={}){
  const {id}=await this.owner(websiteId),head=await this.head(id);
  if(head){if(head.id!==draftId||hash(head)!==expectedRevision)conflict();return this.context(websiteId,{draftId,draftRevision:expectedRevision,websitePin,mutable:true,signal});}
  if(draftId!==null||expectedRevision!==null||!validWebsitePin(websitePin)||websitePin.websiteId!==websiteId)conflict();
  const current=await this.documents.head(websiteId);let basePin=websitePin;
  if(websitePin.websiteRevision===null){
   // The writer may have just extracted this exact inline source into its
   // independent owner. Admit that transition without treating a missing
   // revision as permission to overwrite a subsequently changed document.
   const before=await this.store.snapshot(websitePin.researchSnapshotId);if(before.websiteDocuments)conflict();
   const legacy=await this.documents.legacy(websiteId,{researchSnapshotId:websitePin.researchSnapshotId,signal});
   if(websiteId===null)legacy.site.selection=await defaultWebsiteSelection(this.store,before,{signal});
   const {id:legacyId,...expected}=legacy.site;void legacyId;
   const retained=await this.documents.document(websiteId,{researchSnapshotId:websitePin.researchSnapshotId,websiteRevision:current.websiteRevision,signal});
   // Ignore only the internal default UUID, exactly as the existing object
   // save compatibility path does. Stream the independently growing side.
   const comparable=await new RecordDocument(retained.document.blocks,retained.document.root,{mutable:true}).property([],'id',undefined,{remove:true,signal}),actual=createHash('sha256');
   for await(const chunk of comparable.tree.json(comparable.root,{signal}))actual.update(chunk);
   if(actual.update('\n').digest('hex')!==hash(expected))conflict();
   basePin={...websitePin,websiteRevision:current.websiteRevision};
  }else if(current.websiteRevision!==websitePin.websiteRevision)conflict();
  const context=await this.context(websiteId,{websitePin:basePin,mutable:true,signal});context.checkpoint=await this.prepare(context,{signal});
  const history=this.history(id),checkpointRevision=hash(context.checkpoint);await this.immutable(prefix+'checkpoint:'+id+':'+checkpointRevision,context.checkpoint);const historyRoot=await history.change(null,ordinal(0),checkpointRevision);await history.flush(historyRoot);
  context.head={version:1,workspaceId:(await this.documents.registry()).workspaceId,websiteId:id,id:randomUUID(),base:{researchSnapshotId:basePin.researchSnapshotId,websiteRevision:basePin.websiteRevision},generation:0,position:0,tip:0,history:historyRoot};await this.retainHead(context.head);return context;
 }
 async prepare(context,{signal}={}){
  const collectionIndexes=await WebsiteCollectionIndex.retainAll(context.document,context.checkpoint.collectionIndexes,{signal}),site=await websiteDocumentHeader(context.document,{signal}),snapshot=await this.store.snapshot(context.websitePin.researchSnapshotId),navigationProjection=await WebsiteEditorNavigation.retain(this.store,snapshot,context.document,site,collectionIndexes,context.checkpoint.navigationProjection,{signal});
  await context.document.blocks.flush();return {version:2,root:context.document.root,collectionIndexes,navigationProjection};
 }
 async replaceCollection(context,collection,children,{signal}={}){const root=await retainRecordContainer(context.document.blocks,'array',children,{signal}),document=context.document;context.document=new RecordDocument(document.blocks,await document.replaceReference(document.root,WEBSITE_COLLECTION_PATHS[collection],root,{signal}),{mutable:true});}
 async removePage(context,row,{signal}={}){
  context.document=await context.document.splice(WEBSITE_COLLECTION_PATHS.pages,row.position,1,[],{signal});await this.removeTarget(context,'page:'+row.key,{signal});
 }
 async removeTarget(context,target,{signal}={}){
  const document=context.document;
  for(const collection of ['branding','layouts']){const row=await this.sourceItem(context,collection,target,{signal});if(row)context.document=await context.document.splice(WEBSITE_COLLECTION_PATHS[collection],row.position,1,[],{signal});}
  const presentation=(await context.document.field(['document','website','presentation'],{signal})).value;context.document=await context.document.replace(['document','website','presentation'],{...presentation,media:presentation.media.filter(item=>!item.scope.startsWith(target+'#'))},{signal});
  async function* navigation(){for await(const item of document.items(WEBSITE_COLLECTION_PATHS.navigation,{signal})){const value=await document.tree.read(item.value);if(value.target===target)continue;yield {value:value.parent===target?await document.tree.retain({...value,parent:null}):item.value};}}
  await this.replaceCollection(context,'navigation',navigation(),{signal});
 }
 async apply(context,operation,{signal}={}){
  const snapshot=await this.store.snapshot(context.websitePin.researchSnapshotId),site=await websiteDocumentHeader(context.document,{signal});
  if(operation.type.startsWith('template-')){
   if(operation.type==='template-link'&&/^(project|notebook|entry):/.test(operation.target)&&!await this.sourceItem(context,'layouts',operation.target,{signal})){
    await assertNewWebsiteTemplateTarget(context,operation.target,{store:this.store,sourceReader:this.sourceReader,site,snapshot,signal});
    await this.apply(context,{type:'replace',collection:'layouts',key:operation.target,value:{target:operation.target,showHeading:true,heading:'',description:'',placement:'before',sections:[]}},{signal});context.checkpoint=await this.prepare(context,{signal});
   }
   await changeWebsiteTemplate(context,operation,{signal});return;
  }
  if(operation.type==='theme-apply'){await applyWebsiteTheme(context,operation,{store:this.store,signal});await assertWebsiteTemplateDefinitions(context.document,site.document.website.templates,{signal});return;}
  if(operation.type==='source-selection'){
   if(operation.workspaceId===snapshot.metadata.id)invalid();await requireWebsiteSourceSelections(this.store.db);
   let reader;try{
    const recordProject=async(workspaceId,id)=>{reader??=await this.sourceReader?.({signal});if(!reader)throw new AppError('ACCESS_LOCKED');const result=await reader.use(workspaceId,undefined,async(store,snapshot)=>{const row=await store.member(snapshot,id);if(!row)throw new AppError('RECORD_CHANGED');return snapshot.metadata.notebooks.find(book=>book.id===row.notebookId)?.projectId;});return result.value;};
    context.document=await changeWebsiteSources(context.document,operation,{signal,recordProject,lookup:context.sourceCommandLookup});if(reader)await reader.verify();
   }finally{await reader?.close();}return;
  }
  if(operation.type==='home-remove'){context.document=await context.document.replace(['document','website','home'],emptyHomepage(),{signal});await this.removeTarget(context,'home',{signal});return;}
  if(operation.type==='settings'){const path=operation.path.slice(0,-1),name=operation.path.at(-1);context.document=await context.document.property(path,name,structuredClone(operation.value),{remove:operation.remove===true,signal});const next=await validateWebsiteDocumentHeader(this.store,snapshot,context.document,{signal,draft:true});
   if(['selection','projects'].includes(operation.path[0])){const original=await this.documents.document(context.websitePin.websiteId,context.websitePin),previous=await websiteDocumentHeader(original.document,{signal});await validateWebsiteDocumentSelection(this.store,snapshot,next,{signal,previous});}
   if(operation.path[0]==='document'&&operation.path[1]==='website'){assertUnchangedWebsiteTemplateLinks(site.document.website,next.document.website);await assertWebsiteTemplateDefinitions(context.document,site.document.website.templates,{signal});}
   if(operation.path[0]==='document'&&operation.path[1]==='themes')for(const theme of next.document.themes)if(await this.sourceItem(context,'pages',theme.id,{signal}))invalid();return;}
  // A command's bounded explicit batch is authoritative while validating
  // ancestry. Do not materialize an implicit parent that the same append
  // already supplies, even when the parent follows its children.
  const navigationBatch=operation.type==='append'&&operation.collection==='navigation'?new Map(operation.values.map(value=>[value?.target,value])):null;
  if(navigationBatch&&navigationBatch.size!==operation.values.length)invalid();
  const admit=async(collection,value)=>{
   if(!(collection==='pages'?validWebsitePage(value,{draft:true}):collection==='navigation'?validWebsiteNavigationItem(value):collection==='layouts'?validWebsiteLayout(value):collection==='branding'?validWebsiteBranding(value):validWebsiteAsset(value)))invalid();
   if(['pages','layouts'].includes(collection)){const previous=await this.sourceItem(context,collection,websiteCollectionKey(collection,value),{signal});if(JSON.stringify(previous?.value.templateLink)!==JSON.stringify(value.templateLink))invalid();await validateWebsiteTemplateBinding(context.document,value,{signal,writing:true});if(value.templateLink&&!site.document.website.templates.some(template=>template.id===value.templateLink.templateId))invalid();}
   if(collection==='pages'){
    const id=value.id;if([site.id,snapshot.metadata.id,...snapshot.metadata.projects.map(p=>p.id),...snapshot.metadata.notebooks.map(p=>p.id),...site.document.themes.map(t=>t.id)].includes(id))invalid();
    if(snapshot.indexVersion&&await new SnapshotIndex(this.store).find({root:snapshot.membership},'identity:'+id))invalid();
   }
   if(['layouts','branding'].includes(collection)){
    const book=websiteBook(snapshot.metadata,site),target=value.target;if(!validWebsiteCollectionKey(collection,target))invalid();
    if(target==='home'){if(collection==='layouts'&&book.website.home.enabled===false)invalid();}
    else if(target.startsWith('page:')){if(!await this.sourceItem(context,'pages',target.slice(5),{signal}))invalid();}
    else if(!book.projects.some(item=>target==='project:'+item.id)&&!book.notebooks.some(item=>target==='notebook:'+item.id)&&!publicationPresentationTarget(book.website,target)){
     if(!target.startsWith('entry:'))invalid();const row=await this.store.member(snapshot,target.slice(6));if(!row)invalid();const notebookId=row.notebookId??(await this.store.record(row.id,row.revision)).notebookId;if(!book.notebooks.some(item=>item.id===notebookId))invalid();
    }
   }
   if(collection==='navigation'){
    const source=await WebsiteEditorNavigation.source(this.store,snapshot,context.document,site,context.checkpoint.collectionIndexes,{signal});if(!await source.target(value.target))invalid();const seen=new Set([value.target]);let parent=value.parent;
    while(parent){if(seen.has(parent)||seen.size>8)invalid();seen.add(parent);const ancestor=navigationBatch?.has(parent)?{value:navigationBatch.get(parent)}:await this.sourceItem(context,'navigation',parent,{signal});if(!ancestor){const destination=await source.target(parent);if(!destination)invalid();context.document=await context.document.splice(WEBSITE_COLLECTION_PATHS.navigation,await context.document.tree.arrayLength(context.document.root,WEBSITE_COLLECTION_PATHS.navigation),0,[{target:parent,label:'',show:destination.show,parent:null}],{signal});context.checkpoint=await this.prepare(context,{signal});parent=null;}else parent=ancestor.value.parent;}
   }
  };
  if(operation.type==='append'){
   for(const value of operation.values){await admit(operation.collection,value);if(await this.sourceItem(context,operation.collection,websiteCollectionKey(operation.collection,value),{signal}))invalid();}
   context.document=await context.document.splice(WEBSITE_COLLECTION_PATHS[operation.collection],await context.document.tree.arrayLength(context.document.root,WEBSITE_COLLECTION_PATHS[operation.collection]),0,structuredClone(operation.values),{signal});return;
  }
  if(['replace','remove','page-remove','asset-remove'].includes(operation.type)){
   const collection=['replace','remove'].includes(operation.type)?operation.collection:operation.type==='page-remove'?'pages':'assets',row=await this.sourceItem(context,collection,operation.key,{signal});
   if(!row&&operation.type==='replace'&&['navigation','layouts','branding'].includes(collection)){if(operation.position!==undefined||operation.expectedItemRevision!==undefined)conflict();await admit(collection,operation.value);context.document=await context.document.splice(WEBSITE_COLLECTION_PATHS[collection],await context.document.tree.arrayLength(context.document.root,WEBSITE_COLLECTION_PATHS[collection]),0,[structuredClone(operation.value)],{signal});return;}
   if(!row){if(operation.position!==undefined||operation.expectedItemRevision!==undefined)conflict();notFound();}if(operation.position!==undefined&&operation.position!==row.position||operation.expectedItemRevision!==undefined&&operation.expectedItemRevision!==row.revision)conflict();
   if(operation.type==='replace'){await admit(collection,operation.value);context.document=await context.document.replace([...WEBSITE_COLLECTION_PATHS[collection],String(row.position)],structuredClone(operation.value),{signal});}
   else if(operation.type==='remove')context.document=await context.document.splice(WEBSITE_COLLECTION_PATHS[collection],row.position,1,[],{signal});
   else if(operation.type==='page-remove')await this.removePage(context,row,{signal});
   else{if(await websiteAssetUsage(context.document,row.key,{signal}))invalid();context.document=await context.document.splice(WEBSITE_COLLECTION_PATHS.assets,row.position,1,[],{signal});}return;
  }
  const navigation=await this.navigation(context,site,{signal}),rows=()=>navigation instanceof WebsiteEditorNavigation?navigation.rows({signal}):navigation.rows();
  let selected=null,beforeFound=operation.beforeKey===null;
  if(operation.type==='navigation-move'){for await(const row of rows()){if(row.key===operation.key)selected=row;if(row.key===operation.beforeKey)beforeFound=true;}if(!selected||!beforeFound)notFound();}
  const document=context.document;
  async function* changed(){for await(const row of rows()){
   if(operation.type==='navigation-move'){if(row.key===selected.key)continue;if(row.key===operation.beforeKey)yield {value:await document.tree.retain(selected.value)};}
   yield {value:await document.tree.retain(operation.type==='menu-clear'?{...row.value,show:false}:row.value)};
  }if(operation.type==='navigation-move'&&operation.beforeKey===null)yield {value:await document.tree.retain(selected.value)};}
  await this.replaceCollection(context,'navigation',changed(),{signal});
 }
 async change(websiteId,{draftId=null,expectedRevision=null,websitePin,commandId,operations,signal}={}){
  if(!Array.isArray(operations)||!operations.length||operations.length>32||!operations.every(validWebsiteEditorOperation))invalid();operations=structuredClone(operations);websitePin=structuredClone(websitePin);const {id}=await this.owner(websiteId),receipt=await this.receipt(id,commandId,'change',{draftId,expectedRevision,websitePin,operations});if(receipt.prior)return this.result(websiteId,receipt.prior.result,{signal});
  await requireWebsitePresentation(this.store.db);const context=await this.editing(websiteId,{draftId,expectedRevision,websitePin,signal});
  context.sourceCommandLookup=websiteSourceCommandLookup(operations);
  for(let at=0;at<operations.length;at++){const operation=operations[at];signal?.throwIfAborted();await this.apply(context,operation,{signal});if(operation.type!=='source-selection'||operations[at+1]?.type!=='source-selection')context.checkpoint=await this.prepare(context,{signal});}
  const checkpointRevision=hash(context.checkpoint);await this.immutable(prefix+'checkpoint:'+id+':'+checkpointRevision,context.checkpoint);const history=this.history(id),position=context.head.position+1,root=await history.change(context.head.history,ordinal(position),checkpointRevision);await history.flush(root);
  context.head={...context.head,generation:context.head.generation+1,position,tip:position,history:root};await this.retainHead(context.head);return this.acknowledge(receipt,context,{signal});
 }
 async move(websiteId,type,{draftId,expectedRevision,commandId,signal}={}){
  const {id}=await this.owner(websiteId),receipt=await this.receipt(id,commandId,type,{draftId,expectedRevision});if(receipt.prior)return this.result(websiteId,receipt.prior.result,{signal});const head=await this.head(id);if(!head||head.id!==draftId||hash(head)!==expectedRevision)conflict();
  const position=head.position+(type==='undo'?-1:1);if(position<0||position>head.tip)invalid();const next={...head,position,generation:head.generation+1};await this.retainHead(next);return this.acknowledge(receipt,await this.context(websiteId,{draftId,draftRevision:hash(next),signal}),{signal});
 }
 undo(websiteId,options){return this.move(websiteId,'undo',options);}
 redo(websiteId,options){return this.move(websiteId,'redo',options);}
 async discard(websiteId,{draftId,expectedRevision,commandId,pendingSaveCommandId,signal}={}){
  // Resolve an uncertain save from its receipt. Discard must never execute it.
  if(pendingSaveCommandId!==undefined&&(!researchId(pendingSaveCommandId)||pendingSaveCommandId===commandId))invalid();
  const {id}=await this.owner(websiteId),args={draftId,expectedRevision,...(pendingSaveCommandId===undefined?{}:{pendingSaveCommandId})},receipt=await this.receipt(id,commandId,'discard',args);
  const save=pendingSaveCommandId===undefined?null:await this.receipt(id,pendingSaveCommandId,'commit',{draftId,expectedRevision}),saveCompleted=Boolean(save?.prior);
  const respond=result=>saveCompleted?{...result,saveCompleted:true}:result;
  if(receipt.prior)return respond(await this.result(websiteId,receipt.prior.result,{signal}));
  const head=await this.head(id);
  if(saveCompleted){
   // A later draft belongs to another editing decision; do not discard it.
   if(head)conflict();
   return respond(await this.acknowledge(receipt,await this.context(websiteId,{signal}),{signal}));
  }
  if(!head&&draftId===null&&expectedRevision===null)return this.acknowledge(receipt,await this.context(websiteId,{signal}),{signal});
  if(!head||head.id!==draftId||hash(head)!==expectedRevision)conflict();
  await this.store.db.run('DELETE FROM state WHERE slot=$1',prefix+'head:'+id);
  return this.acknowledge(receipt,await this.context(websiteId,{signal}),{signal});
 }
 async commit(websiteId,{draftId,expectedRevision,commandId,researchSnapshotId,signal}={}){
  const {id}=await this.owner(websiteId),receipt=await this.receipt(id,commandId,'commit',{draftId,expectedRevision});if(receipt.prior)return this.result(websiteId,receipt.prior.result,{signal});const head=await this.head(id);if(!head||head.id!==draftId||hash(head)!==expectedRevision)conflict();
  const context=await this.context(websiteId,{draftId,draftRevision:expectedRevision,mutable:true,signal});researchSnapshotId??=await this.store.head();
  const saved=await this.documents.saveDocument(websiteId,context.document,{researchSnapshotId,expectedRevision:head.base.websiteRevision,collectionIndexes:context.checkpoint.collectionIndexes,navigationProjection:context.checkpoint.navigationProjection,signal});
  await this.store.db.run('DELETE FROM state WHERE slot=$1',prefix+'head:'+id);return this.acknowledge(receipt,await this.context(websiteId,{websitePin:pinOf(saved),signal}),{signal});
 }
}

// Reverse audit includes issued versions after Save/Discard. A publication can
// still pin those roots, so they are authenticated independently of active heads.
export async function verifyWebsiteEditor(store,{signal,onDocument}={}){
 const editor=new WebsiteEditorStore(store),registry=await editor.documents.registry(),format=await catalogueFormat(store.db);
 return withScratch(async checked=>{
  const scope=head=>head.websiteId+':'+head.base.researchSnapshotId+':'+head.base.websiteRevision+':';
  const checkCheckpoint=async(head,revision)=>{
   const identity='verified-checkpoint:'+scope(head)+revision;if(await checked.has(identity))return;
   const checkpoint=await editor.readSlot(prefix+'checkpoint:'+head.websiteId+':'+revision);if(!validCheckpoint(checkpoint)||hash(checkpoint)!==revision||checkpoint.version===2&&!catalogueRequiresWebsitePresentation(format))damaged();
   const blocks=new WebsiteDocumentBlockStore(store,head.websiteId,{readOnly:true}),document=new RecordDocument(blocks,checkpoint.root),snapshot=await store.snapshot(head.base.researchSnapshotId);let site;
   for await(const chunk of document.tree.json(document.root,{signal}))void chunk;
   const prior=await editor.documents.document(head.websiteId===registry.defaultSiteId?null:head.websiteId,head.base),previous=await websiteDocumentHeader(prior.document,{signal});
   try{({site}=await validateWebsiteDocument(store,snapshot,document,{draft:true,signal,previous}));}catch(error){if(['INVALID','FORMAT','LIMIT','WORKSPACE_METADATA_LIMIT'].includes(error.code))damaged();throw error;}
   if(site.id!==head.websiteId||snapshot.metadata.id!==head.workspaceId)damaged();
   for(const collection of Object.keys(checkpoint.collectionIndexes)){const index=await WebsiteCollectionIndex.open(document,collection,checkpoint.collectionIndexes[collection],{signal});if(!index)damaged();await index.verify({signal});}
   await new WebsiteEditorNavigation(document,checkpoint.navigationProjection).verify(store,snapshot,site,checkpoint.collectionIndexes,{signal});
   await onDocument?.(document,{websitePin:{websiteId:head.websiteId===registry.defaultSiteId?null:head.websiteId,...head.base},websiteDraft:{id:head.id,revision:hash(head)}});
   await checked.add('used-checkpoint:'+head.websiteId+':'+revision);await checked.add(identity);
  };
  const checkHead=async(head,owner)=>{
   if(!validHead(head)||head.websiteId!==owner||head.workspaceId!==registry.workspaceId)damaged();
   const base='verified-base:'+scope(head);if(!await checked.has(base)){await editor.documents.revision(owner,head.base.websiteRevision,registry);await checked.add(base);}
   const history=editor.history(owner);
   // An immutable branch can occur in many issued roots. Its successful proof
   // binds the full descriptor and exact contiguous ordinal interval, as well
   // as the original research/website baseline used for checkpoint admission.
   // Keep these receipts in encrypted scratch storage, never a growing JS map.
   const visit=async(ref,start)=>{
    signal?.throwIfAborted();if(!ref)return;
    if(!validIndexRef(ref)||!natural(start)||!natural(start+ref.count))damaged();
    const key='verified-history:'+scope(head)+ref.hash,proof=await checked.get(key);
    if(proof){if(proof.start!==start||['key','hash','height','count'].some(name=>proof.ref[name]!==ref[name]))damaged();return;}
    const node=await history.node(ref),position=start+(node.left?.count??0);
    if(node.id!==ordinal(position))damaged();
    await visit(node.left,start);await checkCheckpoint(head,node.revision);await visit(node.right,position+1);
    await checked.put(key,{ref,start});
   };
   await visit(head.history,0);
  };
  for await(const row of store.db.rows('SELECT slot,payload FROM state WHERE slot COLLATE "C">=$1 AND slot COLLATE "C"<$2 ORDER BY slot COLLATE "C"',[prefix,'website-editor;'],{batchSize:1})){
   signal?.throwIfAborted();if(!registry||!catalogueRequiresWebsiteEditor(format))damaged();const tail=row.slot.slice(prefix.length),value=store.decode('state',row.slot,row.payload);let match,owner;
   if((match=/^head:([a-f0-9-]{36})$/.exec(tail))){owner=match[1];await checkHead(value,owner);const retained=await editor.retainedHead(owner,value.id,hash(value));if(hash(retained)!==hash(value))damaged();}
   else if((match=/^revision:([a-f0-9-]{36}):([a-f0-9-]{36}):([a-f0-9]{64})$/.exec(tail))){owner=match[1];if(value?.id!==match[2]||hash(value)!==match[3])damaged();await checkHead(value,owner);}
   else if((match=/^checkpoint:([a-f0-9-]{36}):([a-f0-9]{64})$/.exec(tail))){owner=match[1];if(!validCheckpoint(value)||hash(value)!==match[2]||value.version===2&&!catalogueRequiresWebsitePresentation(format))damaged();}
   else if((match=/^history:([a-f0-9-]{36}):([a-f0-9]{64})$/.exec(tail))){owner=match[1];if(!value||Object.keys(value).sort().join()!=='id,left,revision,right'||!/^\d{16}$/.test(value.id)||!revisionId(value.revision)||!validIndexRef(value.left)||!validIndexRef(value.right)||hash(value)!==match[2])damaged();}
   else if((match=/^receipt:([a-f0-9-]{36}):([a-f0-9-]{36})$/.exec(tail))){
    owner=match[1];if(!researchId(match[2])||!value||Object.keys(value).sort().join()!=='request,result,version'||value.version!==1||!revisionId(value.request)||!value.result||Object.keys(value.result).sort().join()!=='draft,websitePin'||!validWebsitePin(value.result.websitePin)||value.result.websitePin.websiteId!==(owner===registry.defaultSiteId?null:owner))damaged();
    if(value.result.draft!==null){if(!value.result.draft||Object.keys(value.result.draft).sort().join()!=='id,revision')damaged();const head=await editor.retainedHead(owner,value.result.draft.id,value.result.draft.revision);if(!sameWebsitePin(value.result.websitePin,{websiteId:owner===registry.defaultSiteId?null:owner,...head.base}))damaged();}
    else await editor.documents.document(value.result.websitePin.websiteId,value.result.websitePin);
   }else damaged();
   if(!researchId(owner))damaged();await editor.documents.savedHead(owner,registry,{removed:true});
  }
  const start=prefix+'checkpoint:';
  for await(const row of store.db.rows('SELECT slot FROM state WHERE slot COLLATE "C">=$1 AND slot COLLATE "C"<$2 ORDER BY slot COLLATE "C"',[start,prefix+'checkpoint;'],{batchSize:1})){
   signal?.throwIfAborted();if(!await checked.has('used-checkpoint:'+row.slot.slice(start.length)))damaged();
  }
 },{signal});
}
