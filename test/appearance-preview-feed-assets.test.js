import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {defaultFeed} from '../src/web/website-feed-model.js';
import {AppearancePreviewSessions} from '../src/appearance-preview-sessions.js';
import {MediaStore} from '../src/media.js';
import {WorkspaceFonts} from '../src/workspace-fonts.js';

test('page and project feeds have independently scoped continuation assets in pinned appearance sessions',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-feed-assets-')),book=upgradeNotebook(sampleNotebook());
 book.pages=Array.from({length:5},(_,i)=>({id:randomUUID(),title:'Guide '+i,body:'Shared guide',share:true,sections:[]}));
 const project=book.projects[0];book.projects.push(...Array.from({length:4},(_,i)=>({...structuredClone(project),id:randomUUID(),title:'Project '+i,share:true})));
 book.website.home.sections=['pages','projects'].map(kind=>({id:kind,kind,title:kind,show:true,layout:'list',feed:{...defaultFeed(kind),pageSize:2,visitorOrder:true}}));
 const f=await encryptedFixture(directory,book);t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const sessions=new AppearancePreviewSessions(),command={workspaceId:book.id,etag:(await f.workspace.outline()).etag,appearance:book.appearance,mode:'website'};
 const session=await sessions.create(f.workspace,command,{media:new MediaStore(f.workspace.root,f.vault),fonts:new WorkspaceFonts(f.workspace)}),id=session.baseUrl.split('/')[2];
 const html=(await sessions.file(id,'index.html')).content;
 const configs=[...html.matchAll(/data-feed-config="([^"]+)"/g)].map(match=>JSON.parse(match[1].replaceAll('&quot;','"').replaceAll('&amp;','&')));
 assert.equal(configs.length,2);
 for(const config of configs){
  assert.equal(config.pageSize,2);assert.ok(config.source.startsWith('_assets/'));
  const second=(await sessions.file(id,config.source+'1.html')).content;
  const wrappers=[...second.matchAll(/data-feed-config="([^"]+)"/g)].map(match=>JSON.parse(match[1].replaceAll('&quot;','"').replaceAll('&amp;','&')));
  assert.equal(wrappers.find(value=>value.kind===config.kind).page,1);assert.equal(wrappers.find(value=>value.kind!==config.kind).page,0);
  assert.equal(wrappers.find(value=>value.kind===config.kind).source,config.source);
 }
});
