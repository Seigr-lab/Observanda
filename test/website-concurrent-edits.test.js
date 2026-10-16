import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {createNotebook} from '../src/model.js';
import {clearVault} from '../src/encryption.js';
import {WebsiteSites} from '../src/website-sites.js';
import {requestWriterWait} from '../src/writer-wait.js';

function request(operation){
 const req={waitForWriter:true,checkWriter:async()=>{},socket:{timeout:60000,destroyed:false,setTimeout(){}}},res=new EventEmitter();res.setTimeout=()=>{};res.writableEnded=false;
 return requestWriterWait(req,res,operation);
}
function edit(site,footer){return {workspaceId:site.book.id,baseEtag:site.etag,metadata:{website:{...site.book.website,footer}},projects:[],changes:[],removed:[],selection:site.site.selection};}

test('website edits conflict only with changes to that website and preserve concurrent sites',async()=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-site-edits-'));let fixture;
 try{
  fixture=await encryptedFixture(directory,createNotebook('Publishing workspace'));const sites=new WebsiteSites(fixture.workspace),ids=[];
  for(const name of ['Field journal','Course website'])ids.push((await sites.change({workspaceId:(await fixture.workspace.outline()).metadata.id,etag:(await fixture.workspace.outline()).etag,operation:'create',name})).id);
  const before=await Promise.all(ids.map(id=>sites.read(id))),commands=before.map((site,index)=>edit(site,'Separate footer '+index));
  const results=await Promise.allSettled(commands.map((command,index)=>request(()=>sites.save(ids[index],command))));
  for(const result of results)if(result.status==='rejected')throw result.reason;
  for(const [index,id] of ids.entries())assert.equal((await sites.read(id)).book.website.footer,'Separate footer '+index);
  await assert.rejects(sites.save(ids[0],edit(before[0],'Stale overwrite')),{code:'CONFLICT'});
  const opened=await sites.read(ids[0]);await sites.change({workspaceId:opened.book.id,etag:opened.etag,operation:'rename',id:ids[1],name:'Revised course website'});
  await sites.save(ids[0],edit(opened,'Saved after another website was renamed'));
  assert.equal((await sites.read(ids[1])).site.name,'Revised course website');
  const stale=await sites.read(ids[0]);await sites.change({workspaceId:stale.book.id,etag:stale.etag,operation:'rename',id:ids[0],name:'Revised field journal'});
  await assert.rejects(sites.save(ids[0],edit(stale,'Overwrite after same website changed')),{code:'CONFLICT'});
  assert.equal((await sites.read(ids[0])).book.website.footer,'Saved after another website was renamed');
 }finally{if(fixture)clearVault(fixture.vault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-site-edits-'));await rm(directory,{recursive:true,force:true});}
});
