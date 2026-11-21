import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,rm} from 'node:fs/promises';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {closeIdleMutationFiles} from '../src/mutation-files.js';
import {sampleNotebook} from '../src/sample.js';
import {executeResearchRequest} from '../src/research-requests.js';
import {PublicationConversion} from '../src/publication-conversion.js';
import {WebsiteFileStore,websiteSourceId} from '../src/website-file-store.js';
import {contentBuffer} from '../src/file-content.js';
import {researchReference} from '../src/web/research-reference.js';
import {applyRecordLinks,recordLinkHref} from '../src/website-record-links.js';

const ws='11111111-1111-4111-8111-111111111111',placed='22222222-2222-4222-8222-222222222222',other='33333333-3333-4333-8333-333333333333';

test('record links point to the page that places the record and keep their words elsewhere',()=>{
 const page=body=>'<!doctype html><html lang="en"><head><title>Page</title></head><body>'+body+'</body></html>';
 const html=page('<p><a href="'+recordLinkHref(ws,placed,'record-section-a')+'">Placed study</a>, <a href="'+recordLinkHref(ws,other)+'">Other <em>study</em></a> and <a href="#top">top</a>.</p>');
 const pages=new Map([[ws+'_'+placed,'records/study.html']]);
 assert.equal(applyRecordLinks(html,'notes/index.html',pages),page('<p><a href="../records/study.html#record-section-a">Placed study</a>, Other <em>study</em> and <a href="#top">top</a>.</p>'));
 // A record placed on the same page is linked within it.
 assert.match(applyRecordLinks(html,'records/study.html',pages),/<a href="#record-section-a">Placed study<\/a>/);
 assert.equal(applyRecordLinks(page('<p>No record links.</p>'),'index.html',pages),page('<p>No record links.</p>'));
});

test('a published website links a record copy to another shared record placed on the site',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-record-links-')),book=sampleNotebook(),[first,second,third]=book.entries;
 for(const record of book.entries)record.share=false;
 const link=(text,id)=>({type:'text',text,marks:[{type:'link',attrs:{title:'',target:'_self',nofollow:false,href:researchReference({workspaceId:book.id,kind:'record',id})}}]});
 first.body={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Compare '},link('Shared experiment',second.id),{type:'text',text:' with '},link('Hidden pilot',third.id),{type:'text',text:'.'}]}]};
 const {workspace,vault}=await encryptedFixture(directory,book);
 t.after(async()=>{await closeIdleMutationFiles();await clearVault(vault);await rm(directory,{recursive:true,force:true,maxRetries:12,retryDelay:100});});
 const files=new WebsiteFileStore(workspace),conversion=new PublicationConversion(workspace,{store:files}),command=(route,data)=>executeResearchRequest(workspace,'/api/research/records/'+route,data,{publicationConversion:conversion});
 const share=async record=>{const identity={workspaceId:book.id,recordId:record.id},base=await command('values/read',{...identity,field:'share'});await command('values/save',{...identity,field:'share',expectedRevision:base.revision,value:{value:true}});};
 const source=record=>websiteSourceId({workspaceId:book.id,recordId:record.id,projectId:book.notebooks.find(n=>n.id===record.notebookId).projectId,notebookId:record.notebookId});
 const published=async site=>{const {files:output}=await files.export(site.id,{expectedRevision:site.revision});const pages=new Map();for(const [name,content] of output)if(name.endsWith('.html'))pages.set(name,(await contentBuffer(content)).toString('utf8'));return pages;};
 // The first record is shared before the record it links to.
 await share(first);await share(second);await conversion.settled();
 const created=await files.create({name:'Field notes'});let site=(await files.insertSource(created.site.id,{expectedRevision:created.site.revision,sourceId:source(first)})).site;
 let pages=await published(site),home=pages.get('index.html');
 // Not yet placed: the words stay without a link; the private record stays unnamed.
 assert.match(home,/Compare Private research reference with Private research reference\./);
 assert.doesNotMatch(home,/observanda-record-|Hidden pilot/);assert.ok(![...pages.values()].some(html=>html.includes(third.id)));
 site=(await files.createPage(site.id,{path:'records/experiment.html',title:'Experiment',inclusion:'included',expectedRevision:site.revision})).site;
 site=(await files.insertSource(site.id,{expectedRevision:site.revision,path:'records/experiment.html',sourceId:source(second)})).site;
 pages=await published(site);home=pages.get('index.html');
 assert.match(home,/<a href="records\/experiment\.html"[^>]*>Private research reference<\/a> with Private research reference\./);
 // Updated from the lab book now that the linked record is shared, the link keeps its words.
 await conversion.refreshRecord(workspace,{workspaceId:book.id,notebookId:first.notebookId,recordId:first.id});
 site=(await files.open(site.id)).site;pages=await published(site);home=pages.get('index.html');
 assert.match(home,/Compare <a href="records\/experiment\.html"[^>]*>Shared experiment<\/a> with Private research reference\./);
 assert.doesNotMatch(home,/observanda-record-|Hidden pilot/);assert.ok(![...pages.values()].some(html=>html.includes(third.id)));
});
