import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,realpath} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {createNotebook} from '../src/model.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {WebsiteEditor} from '../src/website-editor.js';
import {WebsiteEditorStore} from '../src/website-editor-store.js';
import {WebsiteSites} from '../src/website-sites.js';
import {websiteWorkspace} from '../src/website-workspace.js';
import {PublicationJobs} from '../src/publication-jobs.js';
import {withPublicationCapture} from '../src/publication-capture.js';
import {readPublicationPage,retainPublicationPages,validatePublicationPages} from '../src/publication-input-pages.js';
import {serialize} from '../src/storage-format.js';
import {contentBuffer} from '../src/file-content.js';
import {AppError} from '../src/errors.js';
import {MediaStore} from '../src/media.js';
const page=(title,body='Page teaser')=>({id:randomUUID(),title,body,share:true,sections:[]});

test('retained page references authenticate original content, teasers and exact shared membership',async()=>{
 const pages=[page('Shared'),{...page('Private','PRIVATE_PAGE'),share:false}],metadata={id:randomUUID(),formatVersion:21,pages:pages.map(value=>({...value,body:'',sections:[]}))},files=new Map(),jobId=randomUUID();
 const workspace={async readMetadata(file,limit){const raw=files.get(file)??null;if(raw!==null&&Buffer.byteLength(raw)>limit)throw new AppError('LIMIT');return raw;},async writeMetadata(file,raw){assert.equal(files.has(file),false);files.set(file,raw);}};
 const refs=await retainPublicationPages(workspace,jobId,metadata,pages),source={version:4,id:jobId,metadata,pageInputs:refs,records:[]};
 validatePublicationPages(source);assert.equal(refs.length,1);assert.equal(files.size,1);assert.deepEqual(await readPublicationPage(workspace,source,pages[0].id),pages[0]);
 assert.throws(()=>validatePublicationPages({...source,pageInputs:[]}),{code:'JOB_DAMAGED'});
 assert.throws(()=>validatePublicationPages({...source,pageInputs:[refs[0],refs[0]]}),{code:'JOB_DAMAGED'});
 assert.throws(()=>validatePublicationPages({...source,pageInputs:[{...refs[0],fileId:pages[0].id}]}),{code:'JOB_DAMAGED'});
 await assert.rejects(readPublicationPage(workspace,{...source,pageInputs:[{...refs[0],excerpt:'Changed teaser'}]},pages[0].id),{code:'JOB_DAMAGED'});
 const file=[...files.keys()][0],original=files.get(file);files.set(file,original.replace('Page teaser','Fake teaser'));
 await assert.rejects(readPublicationPage(workspace,source,pages[0].id),{code:'JOB_DAMAGED'});
 for(const version of [1,2,3])assert.deepEqual(await readPublicationPage(workspace,{version,...(version===1?{book:{pages}}:{metadata:{pages}})},pages[0].id),pages[0]);
});

test('preparing a website beyond the former input envelope reads one pinned custom page at a time',{timeout:180000},async t=>{
 const parent=await realpath(os.tmpdir()),directory=await mkdtemp(path.join(parent,'observanda-page-input-')),book=createNotebook('Prepared custom pages'),f=await encryptedFixture(directory,book);
 t.after(async()=>{clearVault(f.vault);assert.equal(path.dirname(directory),parent);assert.ok(path.basename(directory).startsWith('observanda-page-input-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const sites=new WebsiteSites(f.workspace),websiteId=(await sites.change({workspaceId:book.id,etag:(await f.workspace.outline()).etag,operation:'create',name:'Independent journal'})).id,storage=websiteWorkspace(f.workspace,websiteId),editor=new WebsiteEditor(f.workspace);
 const execute=(operation,data={})=>editor.execute(operation,{workspaceId:book.id,websiteId,...data}),edit=(state,operations)=>({websitePin:state.websitePin,draftId:state.draft?.id??null,expectedRevision:state.draft?.revision??null,commandId:randomUUID(),operations});
 const media=new MediaStore(f.workspace),download=await media.import(Buffer.from('Synthetic downloadable evidence'),'file',{name:'evidence.txt'}),asset={...download,caption:'Evidence file',alt:'',transcript:''};
 delete asset.extension;delete asset.mime;
 const sections=Array.from({length:18},(_,index)=>({id:'paragraph-'+index,kind:'text',title:'Paragraph '+index,show:true,body:'Controlled published observation. '.repeat(1764)}));
 const pages=Array.from({length:18},(_,index)=>({...page('Chapter '+index,'CHAPTER_TEASER_'+index),sections:structuredClone(sections)}));
 pages[0].sections.push({id:'download',kind:'download',title:'Evidence',show:true,assetId:asset.id,label:'Download evidence',body:''});
 const privatePage={...page('Private note','PRIVATE_PAGE_NEVER_PUBLISHED'),share:false};
 let state=await execute('open');state=await execute('change',edit(state,[{type:'append',collection:'assets',values:[asset]},{type:'settings',path:['document','website','home'],value:{enabled:true,title:'Home',introduction:'',showTitle:true,sections:[{id:'page-cards',kind:'pages',title:'Chapters',show:true,layout:'grid'}]}}]));
 for(const value of [...pages,privatePage])state=await execute('change',edit(state,[{type:'append',collection:'pages',values:[value]}]));
 assert.ok(pages.reduce((sum,value)=>sum+Buffer.byteLength(serialize(value)),0)>16*1024*1024);
 const source={workspaceId:book.id,etag:state.websitePin.researchSnapshotId,websitePin:state.websitePin,websiteDraft:{id:state.draft.id,revision:state.draft.revision}},releases=new PublicationJobs(storage),originalDocument=WebsiteEditorStore.prototype.document;
 WebsiteEditorStore.prototype.document=async function(...args){const result=await originalDocument.apply(this,args),read=result.document.tree.read.bind(result.document.tree);result.document.tree.read=async root=>{assert.notEqual(root,result.document.root,'Preparation hydrated the whole website');return read(root);};return result;};
 let pinned;
 try{pinned=await withPublicationCapture(storage,async(captured,id,finish)=>{const value=await releases.pin(source,{workspace:captured,id});return finish(()=>value);});}finally{WebsiteEditorStore.prototype.document=originalDocument;}
 assert.equal(pinned.version,5);assert.equal(pinned.pageInputs.length,pages.length);assert.equal(pinned.summary.media,1);assert.ok(Buffer.byteLength(serialize(pinned))<100000);assert.ok(pinned.metadata.pages.every(value=>value.body===''&&value.sections.length===0));
 assert.equal((await storage.listMetadata('.observanda/release-inputs/'+pinned.id)).length,pages.length);
 await execute('discard',{draftId:state.draft.id,expectedRevision:state.draft.revision,commandId:randomUUID()});
 const reopened=new PublicationJobs(websiteWorkspace(f.workspace,websiteId)),retained=await reopened.source(pinned.id);assert.deepEqual(retained,pinned);
 const job={id:pinned.id,lease:{token:randomUUID()}},candidate=await reopened.prepare(job,{signal:new AbortController().signal,progress:async()=>{}});await storage.withLock(()=>reopened.commit(job,candidate));
 const edition=await reopened.read(candidate.reviewId),home=(await contentBuffer(edition.files.get('index.html'))).toString();
 assert.match(home,/CHAPTER_TEASER_17/);assert.doesNotMatch(home,/PRIVATE_PAGE_NEVER_PUBLISHED/);
 const last=(await contentBuffer(edition.files.get('pages/'+pages.at(-1).id+'.html'))).toString();assert.match(last,/CHAPTER_TEASER_17/);assert.match(last,/Controlled published observation/);
 assert.equal(edition.pages.filter(value=>value.path.startsWith('pages/')).length,pages.length);
 assert.ok([...edition.files.keys()].some(name=>name.startsWith('downloads/')));
 // Capture identities are immutable even when a later source chooses the same file.
 await assert.rejects(withPublicationCapture(storage,async(captured,id)=>{const file='.observanda/release-inputs/'+id+'/'+randomUUID()+'.json';await captured.writeMetadata(file,'{}');await captured.writeMetadata(file,'{"changed":true}');}),{code:'PUBLICATION_IDENTITY'});
 assert.deepEqual(await storage.listMetadata('.observanda/release-captures'),[]);
});
