import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {Workspace} from '../src/storage.js';
import {WebsiteFileStore} from '../src/website-file-store.js';
import {WebsiteFilesCandidate} from '../src/website-files-candidate.js';
import {closeIdleMutationFiles} from '../src/mutation-files.js';
import {contentBuffer} from '../src/file-content.js';
import {downloadFileName,listWebsiteDownloads,removeWebsiteDownload,saveWebsiteDownload} from '../src/website-downloads.js';
import {pendingDownloadName} from '../src/web/website-download-link.js';

async function fixture(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'website-downloads-'));await mkdir(path.join(root,'.observanda'));
 t.after(async()=>{await closeIdleMutationFiles();await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const workspace=new Workspace(root,{id:randomUUID(),key:randomBytes(32)});
 workspace.catalogue=()=>assert.fail('Offering a download opened research storage');
 return {store:new WebsiteFileStore(workspace),id:randomUUID()};
}
const linked=(html,prefix='')=>html.replace('</main>','<p class="website-download"><a href="'+prefix+'downloads/'+pendingDownloadName+'" download="">Paper</a></p></main>');
const published=async(store,id,revision)=>[...(await store.export(id,{expectedRevision:revision})).files.keys()].filter(name=>name.startsWith('downloads/')).sort();

test('download names are safe, unique and keep their file type',()=>{
 const taken=new Set(['downloads/report.pdf']);
 assert.equal(downloadFileName('C:\\Users\\a\\Report.PDF',new Set()),'downloads/Report.pdf');
 assert.equal(downloadFileName('report.pdf',taken),'downloads/report-2.pdf');
 assert.equal(downloadFileName('../../etc/passwd',new Set()),'downloads/passwd');
 assert.equal(downloadFileName('Résultats été 2026 (final).csv',new Set()),'downloads/Résultats-été-2026-final.csv');
 assert.equal(downloadFileName('con.txt',new Set()),'downloads/con-file.txt');
 assert.equal(downloadFileName('.hidden',new Set()),'downloads/hidden');
});

test('a download is delivered only while a page included in the publication links to it',async t=>{
 const {store,id}=await fixture(t);
 const home=await store.create({id,name:'Assay notes'});
 const paper=Buffer.from('%PDF-1.7 measured paper');
 const saved=await saveWebsiteDownload(store,id,{expectedRevision:home.site.revision,path:'index.html',html:linked(home.html),css:home.css,name:'Assay paper.pdf',bytes:paper});
 assert.equal(saved.download,'downloads/Assay-paper.pdf');assert.match(saved.html,/href="downloads\/Assay-paper\.pdf"/);assert.doesNotMatch(saved.html,new RegExp(pendingDownloadName));
 assert.deepEqual(await published(store,id,saved.site.revision),['downloads/Assay-paper.pdf']);
 const exported=(await store.export(id,{expectedRevision:saved.site.revision})).files.get('downloads/Assay-paper.pdf');
 assert.deepEqual(await contentBuffer(exported),paper);
 // A file linked only from a private draft page stays private.
 const draft=await store.createPage(id,{expectedRevision:saved.site.revision,path:'notes/pending.html',title:'Pending notes'});
 const privateFile=await saveWebsiteDownload(store,id,{expectedRevision:draft.site.revision,path:'notes/pending.html',html:linked(draft.html,'../'),css:draft.css,name:'raw readings.csv',bytes:Buffer.from('time,value\n1,2\n')});
 assert.match(privateFile.html,/href="\.\.\/downloads\/raw-readings\.csv"/);
 assert.deepEqual(await published(store,id,privateFile.site.revision),['downloads/Assay-paper.pdf']);
 const candidate=await WebsiteFilesCandidate.open(store,id,privateFile.site.revision,{blockedValues:[]});
 assert.ok(!candidate.files.has('downloads/raw-readings.csv'));
 const listed=await listWebsiteDownloads(store,id,{expectedRevision:privateFile.site.revision});
 assert.deepEqual(listed.items.map(({name,used,published:shown})=>({name,used,published:shown})),[
  {name:'downloads/Assay-paper.pdf',used:true,published:true},
  {name:'downloads/raw-readings.csv',used:true,published:false}
 ]);
 // A linked file cannot be removed; once the link is gone it can.
 await assert.rejects(removeWebsiteDownload(store,id,{expectedRevision:privateFile.site.revision,name:'downloads/Assay-paper.pdf'}),{code:'CONFLICT'});
 const opened=await store.open(id,{path:'index.html'});
 const unlinked=await store.save(id,{expectedRevision:privateFile.site.revision,path:'index.html',html:opened.html.replace(/<p class="website-download">.*?<\/p>/,''),css:opened.css});
 assert.deepEqual(await published(store,id,unlinked.site.revision),[]);
 const removed=await removeWebsiteDownload(store,id,{expectedRevision:unlinked.site.revision,name:'downloads/Assay-paper.pdf'});
 assert.deepEqual((await listWebsiteDownloads(store,id,{expectedRevision:removed.revision})).items.map(item=>item.name),['downloads/raw-readings.csv']);
});

test('an upload is refused unless the saved page links it, and a page that cannot be saved leaves no file',async t=>{
 const {store,id}=await fixture(t);
 const home=await store.create({id,name:'Instrument guide'});
 await assert.rejects(saveWebsiteDownload(store,id,{expectedRevision:home.site.revision,path:'index.html',html:home.html,css:home.css,name:'guide.pdf',bytes:Buffer.from('pdf')}),{code:'INVALID'});
 await assert.rejects(saveWebsiteDownload(store,id,{expectedRevision:home.site.revision,path:'index.html',html:linked(home.html).replace('</main>','<iframe src="https://example.org"></iframe></main>'),css:home.css,name:'guide.pdf',bytes:Buffer.from('pdf')}),{code:'INVALID'});
 const current=await store.open(id);
 assert.equal(current.site.revision,home.site.revision);
 assert.deepEqual((await listWebsiteDownloads(store,id,{expectedRevision:current.site.revision})).items,[]);
});
