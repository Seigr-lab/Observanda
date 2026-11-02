import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,rm} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {closeIdleMutationFiles} from '../src/mutation-files.js';
import {sampleNotebook} from '../src/sample.js';
import {StructureCommands} from '../src/structure-commands.js';
import {executeResearchRequest} from '../src/research-requests.js';
import {PublicationConversion} from '../src/publication-conversion.js';
import {WebsiteFileStore,websiteSourceId} from '../src/website-file-store.js';

test('explicit research saves update a placed HTML entry and withdrawing consent invalidates the old publication',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-entry-conversion-')),book=sampleNotebook(),record=book.entries[2],section={id:randomUUID(),title:'New method',body:'Released method details',share:false};
 record.sections=[section];book.entries=[record];const {workspace,vault}=await encryptedFixture(directory,book);
 t.after(async()=>{await closeIdleMutationFiles();await clearVault(vault);await rm(directory,{recursive:true,force:true,maxRetries:12,retryDelay:100});});
 const files=new WebsiteFileStore(workspace),publicationConversion=new PublicationConversion(workspace,{store:files}),command=(path,data)=>executeResearchRequest(workspace,'/api/research/records/'+path,data,{publicationConversion});
 const identity={workspaceId:book.id,recordId:record.id},key=websiteSourceId({...identity,projectId:book.notebooks[0].projectId,notebookId:record.notebookId}),base=await command('values/read',{...identity,field:'share'});
 await command('values/save',{...identity,field:'share',expectedRevision:base.revision,value:{value:true}});
 const site=await files.create({name:'Shared research'}),placed=await files.insertSource(site.site.id,{expectedRevision:site.site.revision,sourceId:key});assert.match(placed.html,/Listening to the room/);assert.doesNotMatch(placed.html,/Released method/);
 const edited=await files.save(site.site.id,{path:placed.path,expectedRevision:placed.site.revision,html:placed.html.replace('Listening to the room','Edited website title'),css:'p{color:teal}'});
 async function visibility(share){const target={...identity,sectionId:section.id},current=await command('writing/read',target);await command('writing/save',{...target,expectedRevision:current.revision,value:{...current.value,share}});}
 await visibility(true);const visible=await files.open(site.site.id);assert.match(visible.html,/Released method details/);assert.match(visible.html,/Edited website title/);assert.equal(visible.css,edited.css);
 await visibility(false);const withdrawn=await files.open(site.site.id);assert.doesNotMatch(withdrawn.html,/Released method details|New method/);assert.match(withdrawn.html,/Edited website title/);
 await assert.rejects(files.export(site.site.id,{expectedRevision:visible.site.revision}),{code:'CONFLICT'});
 const original=await workspace.outline(),notebook=original.metadata.notebooks.find(item=>item.id===record.notebookId),commandData={etag:original.etag,commandId:randomUUID(),response:'outline',change:{kind:'notebook',value:{...notebook,share:false}}};
 await publicationConversion.mutate(workspace,{route:'/api/workspace/structure',data:commandData},()=>new StructureCommands(workspace).execute('structure',commandData));
 const privateBook=await files.open(site.site.id);assert.doesNotMatch(privateBook.html,/Edited website title|Listening to the room/);assert.match(privateBook.html,/data-observanda-source/);assert.equal(privateBook.css,edited.css);
});
import {convertExistingWebsite} from '../src/website-files-migration.js';
test('a saved home composition and its existing research cards convert once to private-aware website files',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-site-conversion-')),book=sampleNotebook(),record=book.entries[1];book.entries=[record];record.tags=['private-index-tag-canary'];const section={id:randomUUID(),title:'Unreleased experiment details',body:'A newly disclosed method.',share:false};record.sections=[section];
 book.website.home.sections.unshift({id:'authored-heading',kind:'text',show:true,title:'Authored home design',body:'Authored website introduction'});
 const {workspace,vault}=await encryptedFixture(directory,book);t.after(async()=>{await closeIdleMutationFiles();await clearVault(vault);await rm(directory,{recursive:true,force:true,maxRetries:12,retryDelay:100});});
 const files=new WebsiteFileStore(workspace),publicationConversion=new PublicationConversion(workspace,{store:files});
 const imported=await convertExistingWebsite(workspace,files,{websiteId:null}),siteId=imported.site.id;assert.match(imported.html,/Authored home design/);assert.match(imported.html,/Authored website introduction/);assert.match(imported.html,/data-observanda-view="card"/);
 const page=await files.open(siteId,{path:'entries/'+record.id+'.html'});assert.match(page.html,/data-observanda-source/);assert.doesNotMatch(page.html,/A newly disclosed method/);
 const request=(path,data)=>executeResearchRequest(workspace,'/api/research/records/'+path,data,{publicationConversion}),identity={workspaceId:book.id,recordId:record.id};
 const sectionRead=await request('writing/read',{...identity,sectionId:section.id});await request('writing/save',{...identity,sectionId:section.id,expectedRevision:sectionRead.revision,value:{...sectionRead.value,share:true}});
 assert.match((await files.open(siteId,{path:page.path})).html,/A newly disclosed method/);
 const share=await request('values/read',{...identity,field:'share'});await request('values/save',{...identity,field:'share',expectedRevision:share.revision,value:{value:false}});
 const {files:published}=await files.export(siteId);for(const [name,value] of published)if(name.endsWith('.html')){let html='';for await(const chunk of value.readStaged())html+=chunk.toString('utf8');assert.doesNotMatch(html,/Does paper change the color|A newly disclosed method|Would the same pigment|private-index-tag-canary/,name);}
});
