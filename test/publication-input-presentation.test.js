import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm,realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createNotebook} from '../src/model.js';
import {AppError} from '../src/errors.js';
import {serialize} from '../src/storage-format.js';
import {retainPublicationPages,validatePublicationPages} from '../src/publication-input-pages.js';
import {retainPublicationPresentation,validatePublicationPresentation,readPublicationLayout,readPublicationBranding,publicationPresentationReader,publicationPresentationMedia} from '../src/publication-input-presentation.js';
import {selectedContent} from '../src/web/website-model.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {WebsiteEditor} from '../src/website-editor.js';
import {WebsiteEditorStore} from '../src/website-editor-store.js';
import {RecordDocument} from '../src/record-document.js';
import {websiteWorkspace} from '../src/website-workspace.js';
import {PublicationJobs} from '../src/publication-jobs.js';
import {withPublicationCapture} from '../src/publication-capture.js';
import {websiteDocumentPreviewSource} from '../src/website-preview-source.js';
import {publicationPage} from '../src/publication-page.js';
import {MediaStore} from '../src/media.js';
import {contentBuffer} from '../src/file-content.js';
const layout=(target,sections=[])=>({target,showHeading:true,heading:'Retained heading',description:'',placement:'before',sections});
const text=body=>({id:'text',kind:'text',title:'',show:true,body});
const page=()=>({id:randomUUID(),title:'Authored page',body:'Page card teaser',share:true,sections:[]});
const streams=(layouts,branding)=>({layouts:{count:layouts.length,items:layouts},branding:{count:branding.length,items:branding}});
function memory(){const files=new Map(),reads=[];return {files,reads,async readMetadata(file,limit){reads.push(file);const raw=files.get(file)??null;if(raw!==null&&Buffer.byteLength(raw)>limit)throw new AppError('LIMIT');return raw;},async writeMetadata(file,raw){assert.equal(files.has(file),false);files.set(file,raw);}};}
async function retained(metadata,layouts,branding,pages=[]){
 const workspace=memory(),id=randomUUID(),pageInputs=await retainPublicationPages(workspace,id,metadata,pages),presentation=await retainPublicationPresentation(workspace,id,metadata,streams(layouts,branding),{excludeIds:pageInputs.map(row=>row.fileId)}),source={version:5,id,metadata,records:[],pageInputs,...presentation};
 validatePublicationPages(source);validatePublicationPresentation(source);return {workspace,source};
}

test('presentation references authenticate each target and preserve older inline inputs',async()=>{
 const metadata=createNotebook(),authored=page();metadata.pages=[{...authored,body:''}];
 const first=layout('home',[text('Exact original')]),second=layout('page:'+authored.id,[text('Separate target')]),branding={target:'home',logos:[{id:randomUUID(),alt:'Retained logo'}]};
 const {workspace,source}=await retained(metadata,[first,second],[branding],[authored]);
 assert.deepEqual(await readPublicationLayout(workspace,source,'home'),first);assert.deepEqual(await readPublicationBranding(workspace,source,'home'),branding);
 assert.equal(await readPublicationBranding(workspace,source,'page:'+authored.id),null);
 for(const change of [value=>value.layoutInputs.pop(),value=>value.layoutInputs.push(value.layoutInputs[0]),value=>value.brandingInputs[0].fileId=value.layoutInputs[0].fileId,value=>value.layoutInputs[0].fileId=value.pageInputs[0].fileId,value=>value.layoutInputs[0].unexpected=true,value=>value.metadata.website.layouts.push(first)]){const bad=structuredClone(source);change(bad);assert.throws(()=>validatePublicationPresentation(bad),{code:'JOB_DAMAGED'});}
 const ref=source.layoutInputs[1],file='.observanda/release-inputs/'+source.id+'/'+ref.fileId+'.json',original=workspace.files.get(file);workspace.files.set(file,original.replace('Separate target','Tampered target'));
 workspace.reads.length=0;assert.deepEqual(await readPublicationLayout(workspace,source,'home'),first);assert.equal(workspace.reads.includes(file),false);
 await assert.rejects(readPublicationLayout(workspace,source,second.target),{code:'JOB_DAMAGED'});workspace.files.set(file,original);
 const changed={...source,layoutInputs:source.layoutInputs.map(row=>row.target===second.target?{...row,target:'project:'+randomUUID()}:row)};
 await assert.rejects(readPublicationLayout(workspace,changed,changed.layoutInputs[1].target),{code:'JOB_DAMAGED'});
 await assert.rejects(retainPublicationPresentation(memory(),randomUUID(),metadata,{...streams([first],[]),layouts:{count:2,items:[first]}}),{code:'INVALID'});
 for(const version of [1,2,3,4]){const book={...metadata,branding:[branding],website:{...metadata.website,layouts:[first]}};const old={version,...(version===1?{book}:{metadata:book})};assert.deepEqual(await readPublicationLayout(workspace,old,'home'),first);assert.deepEqual(await readPublicationBranding(workspace,old,'home'),branding);validatePublicationPresentation(old);}
});

test('scoped presentation readers traverse references once and isolate caller mutations without caching bodies',async()=>{
 const metadata=createNotebook(),layouts=Array.from({length:128},()=>layout('entry:'+randomUUID(),[text('Exact scoped body')])),branding=layouts.map(value=>({target:value.target,logos:[]})),{workspace,source}=await retained(metadata,layouts,branding);
 const traversals={layouts:0,branding:0};
 for(const [collection,name] of [['layouts','layoutInputs'],['branding','brandingInputs']])source[name]=new Proxy(source[name],{get(array,key,receiver){if(key===Symbol.iterator)traversals[collection]++;return Reflect.get(array,key,receiver);}});
 const reader=publicationPresentationReader(workspace,source),initial={...traversals};assert.ok(initial.layouts>0&&initial.branding>0);
 for(const value of layouts)assert.deepEqual(await reader.layout(value.target),value);
 for(const value of branding)assert.deepEqual(await reader.branding(value.target),value);
 assert.deepEqual(traversals,initial);assert.equal(Object.isFrozen(source.layoutInputs),false);assert.equal(Object.isFrozen(source.layoutInputs[0]),false);
 const ref=source.layoutInputs[0],hash=ref.sha256;ref.sha256='0'.repeat(64);
 assert.deepEqual(await reader.layout(layouts[0].target),layouts[0]);await assert.rejects(readPublicationLayout(workspace,source,layouts[0].target),{code:'JOB_DAMAGED'});ref.sha256=hash;
 const file='.observanda/release-inputs/'+source.id+'/'+ref.fileId+'.json',raw=workspace.files.get(file);workspace.files.set(file,raw.replace('Exact scoped body','Wrong scoped body'));
 await assert.rejects(reader.layout(layouts[0].target),{code:'JOB_DAMAGED'});workspace.files.set(file,raw);
 assert.deepEqual(await reader.layout(layouts[0].target),layouts[0]);source.layoutInputs.push(ref);assert.deepEqual([...reader.layoutTargets()],layouts.map(value=>value.target));assert.throws(()=>publicationPresentationReader(workspace,source),{code:'JOB_DAMAGED'});
});

test('large presentation captures keep bodies outside the manifest and inventory exact logos and assets',async()=>{
 const metadata=createNotebook(),project={id:randomUUID(),title:'Project fallback',description:'',share:true,logoId:randomUUID()},authored=page(),image={id:randomUUID(),kind:'image',caption:'Only layout asset',alt:'',transcript:''},homeLogo=randomUUID(),pageLogo=randomUUID();
 metadata.projects=[project];metadata.pages=[{...authored,body:''}];metadata.website.assets=[image];metadata.website.home={enabled:true,title:'Home',introduction:'',showTitle:true,sections:[{id:'projects',kind:'projects',title:'Projects',show:true,layout:'grid'}]};
 const bulky=Array.from({length:290},()=>layout('entry:'+randomUUID(),[text('x'.repeat(60000))]));
 const layouts=[...bulky,layout('page:'+authored.id,[{id:'asset',kind:'asset',title:'Image',show:true,assetId:image.id}]),{...layout('project:'+project.id),placement:'replace'}],branding=[{target:'home',logos:[{id:homeLogo,alt:'Home'}]},{target:'page:'+authored.id,logos:[{id:pageLogo,alt:'Page'}]}];
 const {workspace,source}=await retained(metadata,layouts,branding,[authored]);assert.ok([...workspace.files.values()].reduce((n,raw)=>n+Buffer.byteLength(raw),0)>16*1024*1024);assert.ok(Buffer.byteLength(serialize(source))<100000);assert.deepEqual(source.metadata.website.layouts,[]);assert.deepEqual(source.metadata.branding,[]);
 const media=await publicationPresentationMedia(workspace,source,selectedContent(metadata));assert.deepEqual(new Set(media.map(value=>value.id)),new Set([image.id,homeLogo,pageLogo,project.logoId]));
 const empty={target:'project:'+project.id,logos:[]},other=await retained(metadata,layouts,[...branding,empty],[authored]);assert.equal((await publicationPresentationMedia(other.workspace,other.source,selectedContent(metadata))).some(value=>value.id===project.logoId),false);
});

test('native previews and retained editions select presentation values and keep exact media after draft discard',{timeout:180000},async t=>{
 const parent=await realpath(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-presentation-input-')),book=createNotebook('Selected presentation'),project={id:randomUUID(),title:'Project fallback',description:'',share:true,logoId:null};book.projects=[project];
 const f=await encryptedFixture(directory,book);t.after(async()=>{clearVault(f.vault);assert.equal(path.dirname(directory),parent);assert.ok(path.basename(directory).startsWith('observanda-presentation-input-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const media=new MediaStore(f.workspace),images=[];for(const color of ['red','blue','green'])images.push(await media.import(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="'+color+'"/></svg>'),'image'));
 const storage=websiteWorkspace(f.workspace,null),editor=new WebsiteEditor(f.workspace),execute=(operation,data={})=>editor.execute(operation,{workspaceId:book.id,websiteId:null,...data}),authored=page(),target='page:'+authored.id;
 let state=await execute('open');state=await execute('change',{websitePin:state.websitePin,draftId:null,expectedRevision:null,commandId:randomUUID(),operations:[
  {type:'append',collection:'pages',values:[authored]},
  {type:'settings',path:['projects'],value:[{id:project.id,share:true,logoId:images[2].id}]},
  {type:'settings',path:['document','website','home'],value:{enabled:true,title:'Home',introduction:'',showTitle:true,sections:[{id:'projects',kind:'projects',title:'Projects',show:true,layout:'grid'},{id:'pages',kind:'pages',title:'Pages',show:true,layout:'grid'}]}},
  {type:'replace',collection:'layouts',key:target,value:layout(target,[text('Selected retained layout')])},
  {type:'replace',collection:'branding',key:'home',value:{target:'home',logos:[{id:images[0].id,alt:'Home retained logo'}]}},
  {type:'replace',collection:'branding',key:target,value:{target,logos:[{id:images[1].id,alt:'Page retained logo'}]}}
 ]});
 const websiteDraft={id:state.draft.id,revision:state.draft.revision},command={workspaceId:book.id,etag:state.websitePin.researchSnapshotId,websitePin:state.websitePin,websiteDraft},field=RecordDocument.prototype.field,document=WebsiteEditorStore.prototype.document,forbidden=new Set(['document/branding','document/website/layouts']),reads=[];
 RecordDocument.prototype.field=function(path,...args){assert.equal(forbidden.has(path.join('/')),false,'Projection/capture read an aggregate presentation collection');reads.push(path.join('/'));return field.call(this,path,...args);};
 WebsiteEditorStore.prototype.document=async function(...args){const selected=await document.apply(this,args),read=selected.document.tree.read.bind(selected.document.tree);selected.document.tree.read=async root=>{assert.notEqual(root,selected.document.root,'Projection/capture hydrated the whole website');return read(root);};return selected;};
 const releases=new PublicationJobs(storage);let pinned;
 try{
  const preview=await websiteDocumentPreviewSource(storage,{websitePin:state.websitePin,websiteDraft},{designTarget:target});assert.deepEqual(preview.context.website.layouts.map(value=>value.target),[target]);assert.deepEqual(new Set(publicationPage(preview.context,target).media.keys()),new Set([images[0].id,images[1].id]));
  const home=await websiteDocumentPreviewSource(storage,{websitePin:state.websitePin,websiteDraft},{designTarget:'home'});assert.ok(publicationPage(home.context,'home').media.has(images[2].id));
  pinned=await withPublicationCapture(storage,async(captured,id,finish)=>{const source=await releases.pin(command,{workspace:captured,id});return finish(()=>source);});
 }finally{RecordDocument.prototype.field=field;WebsiteEditorStore.prototype.document=document;}
 assert.equal(pinned.version,5);assert.deepEqual(pinned.presentationCounts,{layouts:1,branding:2});assert.equal(pinned.summary.media,3);assert.ok(reads.includes('document/website/layouts/0'));
 await execute('discard',{draftId:state.draft.id,expectedRevision:state.draft.revision,commandId:randomUUID()});
 const job={id:pinned.id,lease:{token:randomUUID()}},candidate=await releases.prepare(job,{signal:new AbortController().signal,progress:async()=>{}});await storage.withLock(()=>releases.commit(job,candidate));const edition=await releases.read(candidate.reviewId);
 const html=(await contentBuffer(edition.files.get('pages/'+authored.id+'.html'))).toString();assert.match(html,/Selected retained layout/);assert.match(html,/Page retained logo/);assert.match((await contentBuffer(edition.files.get('index.html'))).toString(),/Page card teaser/);
 for(const image of images)assert.ok(edition.files.has('media/'+image.id+'.png'));
 let interrupted;await assert.rejects(withPublicationCapture(storage,async(captured,id)=>{interrupted=id;await retainPublicationPresentation(captured,id,pinned.metadata,streams([layout('home',[{id:'large',kind:'copy-text',title:'',show:true,value:'x'.repeat(300000),body:'',label:'Copy'}])],[]));throw new DOMException('Capture cancelled','AbortError');}),{name:'AbortError'});
 assert.deepEqual(await storage.listMetadata('.observanda/release-inputs/'+interrupted),[]);assert.deepEqual(await storage.listMetadata('.observanda/release-captures'),[]);
});
