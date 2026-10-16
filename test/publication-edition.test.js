import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {clearVault} from '../src/encryption.js';
import {PublicationJobs} from '../src/publication-jobs.js';
import {workspaceJobs} from '../src/workspace-jobs.js';
import {MediaStore} from '../src/media.js';
import {buildPublication,verifyPublication,verifyPublicationManifest} from '../src/publication.js';
import {contentBuffer,FileContent,writeContent} from '../src/file-content.js';
import {admitRetainedPublicFile,assertPublicFiles} from '../src/privacy.js';
import {createRegion,assignRegion} from '../src/web/website-regions.js';
import {newElement} from '../src/web/composition-tree.js';
import {plainRichText} from '../src/web/rich-text-model.js';
import {publicationText} from './publication-fixture.js';
import {defaultFeed} from '../src/web/website-feed-model.js';
import {feedFilePath} from '../src/publication-feeds.js';
const options=()=>({signal:new AbortController().signal,progress:async()=>{}});
async function fixture(t){const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-edition-pages-')),book=upgradeNotebook(sampleNotebook()),f=await encryptedFixture(directory,book),jobs=workspaceJobs(f.workspace);t.after(async()=>{await jobs.worker.stop();clearVault(f.vault);await rm(directory,{recursive:true,force:true});});return {...f,...jobs,directory,book,releases:new PublicationJobs(f.workspace)};}
async function prepare(f,book){const current=await f.workspace.outline(),job=await f.releases.start({etag:current.etag,book},f.queue),lease=await f.queue.claim(),output=await f.releases.prepare(lease,options());assert.equal(lease.id,job.id);await f.queue.complete(job.id,lease.lease.token,output);return f.releases.read(output.reviewId);}

test('a retained edition manifest must account for each file exactly once',()=>{
 const candidate=buildPublication(upgradeNotebook(sampleNotebook()));verifyPublicationManifest(candidate);
 const manifest=JSON.parse(candidate.files.get('publication.json'));assert.ok(manifest.files.length>1);
 manifest.files[1]=manifest.files[0];candidate.files.set('publication.json',JSON.stringify(manifest));
 assert.throws(()=>verifyPublicationManifest(candidate),{code:'STALE'});
});

test('retained editions preserve independent feed groups on different website pages',async t=>{
 const f=await fixture(t),book=f.book,seed=book.entries[0];
 book.entries=Array.from({length:23},(_,index)=>({...structuredClone(seed),id:randomUUID(),title:'Public result '+index,share:true,sections:[],figures:[],attachments:[],relations:[]}));
 const section=(id,size)=>({id,kind:'records',title:id,show:true,layout:'list',feed:{...defaultFeed('records'),pageSize:size,visitorFilters:true,visitorOrder:true}});
 book.website.home.sections=[section('three-at-once',3),section('seven-at-once',7)];
 book.pages.push({id:randomUUID(),title:'Results in detail',body:'',share:true,sections:[section('five-at-once',5)]});
 const expected=buildPublication(book),actual=await prepare(f,book);verifyPublication(actual);
 assert.deepEqual([...actual.files.keys()].sort(),[...expected.files.keys()].sort());
 const feeds=[...actual.files].filter(([name])=>feedFilePath(name));assert.equal(feeds.length,8+4+5);
 for(const [name,content] of feeds)assert.deepEqual(await contentBuffer(content),await contentBuffer(expected.files.get(name)),name);
 assert.deepEqual(await contentBuffer(actual.files.get('public-feeds.js')),await contentBuffer(expected.files.get('public-feeds.js')));
});

test('retained page editions preserve HTML, figures, links, media, reusable regions and mixed typography',async t=>{
 const f=await fixture(t),book=f.book,media=new MediaStore(f.workspace.root,f.vault);
 const image=await media.import(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="blue"/></svg>'),'image');
 const first=book.entries[0];first.share=true;first.attachments=[{...image,caption:'Selected illustration',alt:'Blue square',transcript:'Shared caption detail',share:true}];
 const privateRecord={...structuredClone(first),id:randomUUID(),title:'Private excluded procedure',share:false,relations:[],figures:[],attachments:[]};book.entries.push(privateRecord);
 first.relations.push({id:randomUUID(),type:'References',target:{workspaceId:book.id,kind:'record',id:privateRecord.id},label:'C:/Users/private/method'});
 const second=book.entries[1];second.type='run';second.share=true;second.relations=[{id:randomUUID(),type:'Run / take of',role:'run-of',target:{workspaceId:book.id,kind:'record',id:first.id},label:first.title}];second.outcome='A retained result';
 second.body=plainRichText('Styled public result');second.body.content[0].content[0].marks=[{type:'font_family',attrs:{font:'source-serif'}},{type:'text_color',attrs:{color:'#993344'}}];
 const footer=createRegion(book.website,'footer','Shared footer',{makeId:randomUUID});footer.sections=[{...newElement('text',randomUUID),body:'Authored closing text',style:{width:'full',surface:'none',align:'start',space:'normal',bodyAlign:'end'}}];assignRegion(book.website,'*','footer',footer.id);
 const side=createRegion(book.website,'sidebar','Page contents',{makeId:randomUUID});side.sections=[{...newElement('contents',randomUUID),title:'Contents'}];assignRegion(book.website,'*','sidebar',side.id);
 book.website.home.sections.push({...newElement('media',randomUUID),entryId:first.id,attachmentId:image.id});
 book.pages.push({id:randomUUID(),title:'Methods',body:'Selected custom page',share:true,sections:[{...newElement('heading',randomUUID),title:'A method heading'}]});
 const expected=buildPublication(book,{mediaFiles:await media.publicFiles(book,{streamed:true})}),actual=await prepare(f,book);
 assert.deepEqual([...actual.files.keys()].sort(),[...expected.files.keys()].sort());assert.deepEqual(actual.pages,expected.pages);
 for(const [name,content] of actual.files){if(['styles.css','publication.json'].includes(name))continue;assert.deepEqual(await contentBuffer(content),await contentBuffer(expected.files.get(name)),name);if(/\.html$/.test(name))assert.ok(content instanceof FileContent);}
 const css=(await contentBuffer(actual.files.get('styles.css'))).toString();for(const rule of ['.rt-color-993344{color:#993344}','--footer-text-align:end','font-family:'])assert.ok(css.includes(rule));
 assert.ok(actual.files.has('fonts/source-serif.ttf'));assert.ok((await publicationText(actual)).includes('Runs and takes'));verifyPublication(actual);
});

test('retained file privacy admission is bound to bytes, output name and blocked values',async t=>{
 const f=await fixture(t),file=path.join(f.workspace.root,'output.blob'),text='<!doctype html><p>Public page</p>',saved=await writeContent(f.workspace,file,[text]);
 const content=new FileContent(f.workspace,file,saved.size,saved.sha256);
 assert.throws(()=>assertPublicFiles(new Map([['index.html',content]])),{code:'UNSAFE'});
 await admitRetainedPublicFile('index.html',content,{type:'text'});assertPublicFiles(new Map([['index.html',content]]));
 assert.throws(()=>assertPublicFiles(new Map([['private.json',content]])),{code:'UNSAFE'});
 assert.throws(()=>assertPublicFiles(new Map([['index.html',content]]),['Public page']),{code:'UNSAFE'});
 await assert.rejects(admitRetainedPublicFile('index.html',content,{type:'text',blockedValues:['Public page']}),{code:'PRIVACY'});
 content.size++;assert.throws(()=>assertPublicFiles(new Map([['index.html',content]])),{code:'UNSAFE'});content.size--;
 await writeContent(f.workspace,file,['<!doctype html><p>Changed after verification</p>']);await assert.rejects(contentBuffer(content),{code:'MEDIA_INVALID'});
});

test('corrupted pinned originals and interrupted page writes cannot commit an edition',async t=>{
 const f=await fixture(t),current=await f.workspace.outline(),job=await f.releases.start({etag:current.etag},f.queue),lease=await f.queue.claim(),source=await f.releases.source(job.id);
 const pinned='.observanda/release-inputs/'+job.id+'/'+source.records[0].id+'.json',raw=await f.workspace.readMetadata(pinned);
 await f.workspace.withLock(()=>f.workspace.writeMetadata(pinned,raw.replace('body','altered')));await assert.rejects(f.releases.prepare(lease,options()),{code:'JOB_DAMAGED'});assert.equal(await f.releases.read(source.reviewId),null);
 await f.workspace.withLock(()=>f.workspace.writeMetadata(pinned,raw));
 const controller=new AbortController();await assert.rejects(f.releases.prepare(lease,{signal:controller.signal,progress:async()=>controller.abort()}),{name:'AbortError'});assert.equal(await f.releases.read(source.reviewId),null);
 const output=await f.releases.prepare(lease,options());await f.queue.complete(job.id,lease.lease.token,output);assert.ok(await f.releases.read(source.reviewId));
});
