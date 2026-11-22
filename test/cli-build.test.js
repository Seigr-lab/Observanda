import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {sampleNotebook} from '../src/sample.js';
import {createWorkspaceAccess,takeCreatedVault} from '../src/access.js';
import {TestDeviceStore} from './device-fixture.js';
import {initializeLocation} from '../src/locations.js';
import {Workspace} from '../src/storage.js';
import {clearVault} from '../src/encryption.js';
import {closeIdleMutationFiles} from '../src/mutation-files.js';
import {executeResearchRequest} from '../src/research-requests.js';
import {PublicationConversion} from '../src/publication-conversion.js';
import {WebsiteFileStore,websiteSourceId} from '../src/website-file-store.js';

function cli(args,password){
 return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['src/cli.js',...args],{windowsHide:true,stdio:['pipe','pipe','pipe']}),timer=setTimeout(()=>{child.kill();reject(Error('CLI timed out'));},120000);
  let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);child.once('error',reject);
  child.once('close',code=>{clearTimeout(timer);resolve({code,output});});child.stdin.end(password+'\n');
 });
}
async function files(root,relative=''){
 const found=[];
 for(const entry of await readdir(path.join(root,relative),{withFileTypes:true})){
  const name=path.posix.join(relative,entry.name);
  if(entry.isDirectory())found.push(...await files(root,name));else found.push(name);
 }
 return found;
}

test('build exports a chosen website made in the website editor into a new folder',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-cli-build-')),root=path.join(directory,'Field notes'),password='synthetic CLI build passphrase',preferences=path.join(directory,'preferences.json');
 const book=sampleNotebook(),[,hidden,shared]=book.entries;hidden.share=false;shared.share=false;book.entries=[hidden,shared];
 // The CLI keeps its device store next to the preferences it is given.
 const access=await createWorkspaceAccess('',password,new TestDeviceStore({file:preferences+'.device-key'})),vault=takeCreatedVault(access);
 t.after(async()=>{await closeIdleMutationFiles();await clearVault(vault);await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 await initializeLocation(root,book,access,vault);
 const options=['--workspace',root,'--preferences',preferences,'--password-stdin'];

 // Without a website there is nothing to export.
 const empty=await cli(['build',...options,'--out',path.join(directory,'none')],password);
 assert.equal(empty.code,1,empty.output);assert.match(empty.output,/no website yet/);

 // The author shares one record and places it on a website; a second website holds only its own text.
 const workspace=new Workspace(root,vault),store=new WebsiteFileStore(workspace),conversion=new PublicationConversion(workspace,{store});
 const command=(name,data)=>executeResearchRequest(workspace,'/api/research/records/'+name,data,{publicationConversion:conversion});
 const identity={workspaceId:book.id,recordId:shared.id},share=await command('values/read',{...identity,field:'share'});
 await command('values/save',{...identity,field:'share',expectedRevision:share.revision,value:{value:true}});
 const notebook=book.notebooks.find(item=>item.id===shared.notebookId),sourceId=websiteSourceId({...identity,projectId:notebook.projectId,notebookId:notebook.id});
 const results=await store.create({name:'Field results'});await store.insertSource(results.site.id,{expectedRevision:results.site.revision,sourceId});
 await store.create({name:'Studio notes',html:'<main><h1>Studio notes</h1><p>Written in the website editor.</p></main>'});
 await closeIdleMutationFiles();

 const ambiguous=await cli(['build',...options,'--out',path.join(directory,'ambiguous')],password);
 assert.equal(ambiguous.code,1,ambiguous.output);assert.match(ambiguous.output,/--site/);assert.match(ambiguous.output,/Field results/);assert.match(ambiguous.output,/Studio notes/);

 const out=path.join(directory,'exported'),built=await cli(['build',...options,'--site','Field results','--out',out],password);
 assert.equal(built.code,0,built.output);assert.match(built.output,/Website exported: \d+ pages, \d+ files\./);
 const names=await files(out);assert.ok(names.includes('index.html'),names.join());
 const text=(await Promise.all(names.filter(name=>/\.(html|css|json|xml|txt)$/.test(name)).map(name=>readFile(path.join(out,name),'utf8')))).join('\n');
 assert.ok(text.includes(shared.title));assert.ok(!text.includes(hidden.title));assert.ok(!text.includes('Studio notes'));
 assert.ok(!text.includes(root)&&!text.includes(directory),'No local paths are published');

 // Existing output is never overwritten.
 const again=await cli(['build',...options,'--site','Field results','--out',out],password);
 assert.notEqual(again.code,0);assert.deepEqual((await files(out)).sort(),[...names].sort());
});
