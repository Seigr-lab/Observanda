import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createNotebook} from '../src/model.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {WebsiteEditor} from '../src/website-editor.js';
import {WorkspaceFonts} from '../src/workspace-fonts.js';
import {startServer} from '../src/server.js';

test('closing cancels an unfinished draft preview without treating it as unsaved work',{timeout:30000},async t=>{
 const parent=await realpath(os.tmpdir()),root=await mkdtemp(path.join(parent,'observanda-preview-close-')),book=createNotebook('Preview close');book.website.home.enabled=true;
 const f=await encryptedFixture(root,book);let app;
 const entered=Promise.withResolvers(),cancelled=Promise.withResolvers();
 t.after(async()=>{await app?.close();clearVault(f.vault);assert.equal(path.dirname(root),parent);await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const editor=await new WebsiteEditor(f.workspace).execute('open',{workspaceId:book.id,websiteId:null});
 app=await startServer({root:f.workspace.root,deviceStore:f.deviceStore,preferencesFile:path.join(root,'preferences.json'),port:0});
 const session=await fetch(app.origin+'/api/session',{method:'POST',headers:{Origin:app.origin,'Content-Type':'application/json'},body:JSON.stringify({token:app.launchToken})});assert.equal(session.status,200);
 const cookie=session.headers.get('set-cookie').split(';')[0],context=(await(await fetch(app.origin+'/api/storage',{headers:{Cookie:cookie}})).json()).contextId;
 t.mock.method(WorkspaceFonts.prototype,'files',async function(_,{signal}){
  entered.resolve();await new Promise((_,reject)=>{const abort=()=>{cancelled.resolve();reject(signal.reason);};if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});});
 });
 const request=fetch(app.origin+'/api/appearance-preview',{method:'POST',headers:{Cookie:cookie,Origin:app.origin,'Content-Type':'application/json','X-Observanda-Workspace':context},body:JSON.stringify({workspaceId:book.id,etag:editor.websitePin.researchSnapshotId,websitePin:editor.websitePin,appearance:book.appearance,mode:'website'})}).then(async response=>{throw Error('Preview ended before cancellation: '+response.status+' '+await response.text());},error=>error);
 await Promise.race([entered.promise,request.then(error=>{throw error;})]);
 assert.equal(app.shutdownStatus().busy,false,'A read-only draft preview must not demand that work finish before closing');
 await app.close();await cancelled.promise;assert.ok(await request instanceof Error);
});
