import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {sampleNotebook} from '../src/sample.js';
import {validateNotebook} from '../src/model.js';
import {Workspace} from '../src/storage.js';
import {MediaStore} from '../src/media.js';
import {buildPublication,verifyPublication} from '../src/publication.js';
import {newElement} from '../src/web/composition-tree.js';
import {publicProjection} from '../src/publication-projection.js';
import {publicationPage} from '../src/publication-page.js';
import {assertPublicFiles} from '../src/privacy.js';
import {validDownloadName,downloadPath} from '../src/web/website-file.js';
import {websiteMediaItems} from '../src/web/website-inventory.js';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const reference=(id,name,bytes)=>({id,kind:'file',name,size:bytes.length,sha256:hash(bytes),caption:'',alt:'',transcript:''});
const element=assetId=>({...newElement('download',randomUUID),assetId,label:'Download experiment',body:'Exact original'});
const media=(ref,bytes)=>({...ref,extension:'bin',mime:'application/octet-stream',bytes});

test('download selection includes only visible public uses, preserves exact bytes and filenames, and supports independent styles',()=>{
 const bytes=Buffer.from('<html>Original file, not a generated site page</html>'),id=randomUUID(),ref=reference(id,'mesures α.html',bytes),book=sampleNotebook();
 book.website.assets=[ref];book.website.home.sections=[element(id)];validateNotebook(book);
 const files=new Map([[id,media(ref,bytes)]]),candidate=buildPublication(book,{mediaFiles:files});verifyPublication(candidate);
 assert.deepEqual(candidate.files.get(downloadPath(id)),bytes);
 const html=candidate.files.get('index.html');assert.match(html,/class="site-action site-action--link/);assert.ok(html.includes('download="mesures α.html"'));assert.ok(!candidate.files.has('mesures α.html'));
 assert.equal(publicationPage(publicProjection(book),'home').media.get(id),'file');
 assert.equal([...websiteMediaItems(book,{kind:'file'})][0].label,ref.name);assert.equal([...websiteMediaItems(book,{kind:'media'})].length,0);
 book.website.home.sections[0].action={appearance:'button',style:{background:'#123456',radius:14}};
 const styled=buildPublication(book,{mediaFiles:files});assert.match(styled.files.get('index.html'),/class="site-action site-action--button/);assert.ok(styled.files.get('styles.css').includes('#123456'));
 book.website.home.sections[0].show=false;
 book.pages.push({id:randomUUID(),title:'Private files',body:'',share:false,sections:[element(id)]});
 const hidden=buildPublication(book,{mediaFiles:files});assert.ok(!hidden.files.has(downloadPath(id)));assert.ok(![...hidden.files.values()].some(v=>typeof v==='string'&&v.includes(ref.name)));
 book.website.home.sections=[];book.pages[0].share=true;const shown=buildPublication(book,{mediaFiles:files});assert.ok(shown.files.get('pages/'+book.pages[0].id+'.html').includes('href="../'+downloadPath(id)+'"'));
 const popup={...newElement('popup',randomUUID),show:false};book.pages[0].sections=[popup,{...element(id),parentId:popup.id}];assert.ok(!buildPublication(book,{mediaFiles:files}).files.has(downloadPath(id)));
});

test('download references reject changed bytes, names and misleading sizes; binary admission rejects executable paths',()=>{
 const bytes=Buffer.from([0,1,255]),id=randomUUID(),ref=reference(id,'capture.img',bytes),book=sampleNotebook();book.website.assets=[ref];book.website.home.sections=[element(id)];
 for(const change of [{bytes:Buffer.from([0,1,254])},{name:'other.img'},{kind:'image'},{extension:'html'},{mime:'text/html'}])assert.throws(()=>buildPublication(book,{mediaFiles:new Map([[id,{...media(ref,bytes),...change}]])}),{code:'MEDIA_INVALID'});
 book.website.assets[0].size++;assert.throws(()=>buildPublication(book,{mediaFiles:new Map([[id,media(ref,bytes)]])}),{code:'MEDIA_INVALID'});
 for(const name of ['../secrets','a/b','a\\b','bad\u0000name','..','.',' '])assert.equal(validDownloadName(name),false);
 assert.ok(validDownloadName('résultats α.img'));
 for(const name of ['downloads/'+id+'.html','downloads/'+id+'.js','downloads/../index.html','downloads/other.bin'])assert.throws(()=>assertPublicFiles(new Map([[name,bytes]])),{code:'UNSAFE'});
});

test('immediate imports and empty originals remain exact downloads without conversion',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-empty-download-'));t.after(()=>rm(root,{recursive:true,force:true}));const workspace=new Workspace(root);await workspace.create(sampleNotebook());
 const store=new MediaStore(root),asset=await store.import(Buffer.alloc(0),'file',{name:'empty.txt'});assert.equal(asset.size,0);assert.deepEqual((await store.get(asset.id)).bytes,Buffer.alloc(0));
 await assert.rejects(store.import(Buffer.alloc(0),'file',{name:'../wrong'}),{code:'MEDIA_INVALID'});
});
