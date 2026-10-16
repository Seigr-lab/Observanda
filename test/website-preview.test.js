import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {buildPublication,publicProjection,verifyPublication} from '../src/publication.js';
import {websitePreview} from '../src/website-preview.js';
import {publicationPage} from '../src/publication-page.js';
import {layoutTargets,defaultPageLayout} from '../src/web/website-layouts.js';
import {createRegion,assignRegion} from '../src/web/website-regions.js';
import {newElement} from '../src/web/composition-tree.js';

const image=await readFile(new URL('../src/preview-assets/image.png',import.meta.url));
function fixture(){
 const book=upgradeNotebook(sampleNotebook()),files=new Map();
 const asset=(kind='image')=>{const a={id:randomUUID(),kind,caption:kind,alt:kind,transcript:'',share:true};files.set(a.id,{id:a.id,kind,extension:{image:'png',audio:'wav',video:'mp4'}[kind],bytes:image});return a;};
 const shared=asset(),other=asset(),cover=asset(),recording=asset('audio');
 book.website.assets.push(...[shared,other].map(({share,...asset})=>asset));
 book.entries[0].attachments.push(cover,recording);
 const footer=createRegion(book.website,'footer','Shared footer',{makeId:randomUUID});
 footer.sections=[{...newElement('asset',randomUUID),assetId:shared.id},{...newElement('text',randomUUID),body:'Field notes',style:{width:'full',surface:'none',align:'start',space:'normal',bodyAlign:'end'}}];
 assignRegion(book.website,'*','footer',footer.id);
 const sidebar=createRegion(book.website,'sidebar','Contents',{makeId:randomUUID});sidebar.sections=[{...newElement('contents',randomUUID),title:'On this page'}];assignRegion(book.website,'*','sidebar',sidebar.id);
 book.pages.push({id:randomUUID(),title:'Other page',body:'Other page text',share:false,sections:[{...newElement('asset',randomUUID),assetId:other.id}]});
 book.website.home.sections=book.website.home.sections.filter(s=>s.kind!=='records');
 return {book,files,shared,other,cover,recording};
}
function services(files){
 const loaded=[],fontInputs=[];
 return {loaded,fontInputs,media:{async get(id){loaded.push(id);assert.ok(files.has(id),'Unplanned media read '+id);return files.get(id);}},fonts:{async files(value){fontInputs.push(value);return new Map();}}};
}

test('each canvas page matches the complete renderer with reusable regions, covers and figures',async()=>{
 const {book,files}=fixture();
 for(const {target,path} of layoutTargets(book)){
  const all=buildPublication(book,{mediaFiles:files,designTarget:target,workspaceContent:true}),service=services(files);
  const one=await websitePreview(book,{designTarget:target,...service});
  assert.equal(one.files.get(path),all.files.get(path),target);
  assert.deepEqual(one.pages,all.pages.filter(p=>p.path===path));
  assert.equal(one.defaultPage,path);assert.equal(one.designOnly,true);
  assert.deepEqual([...one.files.keys()].filter(name=>name.endsWith('.html')),[path]);
  for(const [name,bytes] of one.files)if(!['publication.json','styles.css'].includes(name))assert.deepEqual(bytes,all.files.get(name),name);
  verifyPublication(one,{allowDesign:true});assert.throws(()=>verifyPublication(one),{code:'INVALID'});
  if(!target.startsWith('entry:'))assert.ok(![...one.files.keys()].some(name=>name.startsWith('figures/')));
  assert.ok(one.files.get('styles.css').includes('--footer-text-align:end'));
 }
});

test('home canvas ignores unavailable media belonging exclusively to other pages and records',async()=>{
 const {book,files,shared,other,recording}=fixture(),service=services(new Map([[shared.id,files.get(shared.id)]]));
 const result=await websitePreview(book,{designTarget:'home',...service});
 assert.deepEqual(service.loaded,[shared.id]);
 assert.ok(!result.files.has('media/'+other.id+'.png'));assert.ok(!result.files.has('media/'+recording.id+'.wav'));
 assert.ok(!JSON.stringify(result.pages).includes(book.entries[0].id));
 assert.throws(()=>buildPublication(book,{mediaFiles:new Map([[shared.id,files.get(shared.id)]])}),{code:'MEDIA_INVALID'});
});

test('replacement layouts prepare only the replacement and visible region assets',async()=>{
 const {book,files,shared}=fixture();
 for(const {target,path} of layoutTargets(book).filter(t=>t.target.startsWith('project:')||t.target.startsWith('notebook:'))){
  book.website.layouts.push({...defaultPageLayout(target),placement:'replace',sections:[{...newElement('heading',randomUUID),title:'Replacement'}]});
  const service=services(new Map([[shared.id,files.get(shared.id)]]));
  const one=await websitePreview(book,{designTarget:target,...service});
  assert.match(one.files.get(path),/Replacement/);assert.deepEqual(service.loaded,[shared.id],target);
 }
});

test('card selections, explicit no-cover choices and research-media blocks have exact dependencies',async()=>{
 const {book,files,cover,recording,shared}=fixture();
 book.website.home.sections=[{...newElement('records',randomUUID),filter:{projectId:null,tag:'',limit:1}}];
 // Put the media-bearing record first for date-desc discovery.
 book.entries.forEach(record=>record.occurredOn='2026-01-01');book.entries[0].occurredOn='2026-10-03';
 let service=services(files);await websitePreview(book,{designTarget:'home',...service});
 assert.deepEqual(new Set(service.loaded),new Set([shared.id,cover.id]));
 book.website.presentation.covers.push({entryId:book.entries[0].id,attachmentId:null});
 book.website.home.sections.push({...newElement('media',randomUUID),entryId:book.entries[0].id,attachmentId:recording.id});
 service=services(files);await websitePreview(book,{designTarget:'home',...service});
 assert.deepEqual(new Set(service.loaded),new Set([shared.id,recording.id]));
});

test('page plan rejects absent destinations and cancellation stops preparation before rendering',async()=>{
 const {book,files,shared}=fixture(),context=publicProjection(book,{designTarget:'home',workspaceContent:true});
 assert.throws(()=>publicationPage(context,'entry:'+randomUUID()),{code:'INVALID'});
 assert.throws(()=>publicationPage(context,null),{code:'INVALID'});
 const controller=new AbortController(),error=Error('Cancelled');
 const service=services(files);service.media.get=async id=>{assert.equal(id,shared.id);controller.abort(error);return files.get(id);};
 await assert.rejects(websitePreview(book,{designTarget:'home',...service,signal:controller.signal}),error);
 assert.deepEqual(service.fontInputs,[]);
});
