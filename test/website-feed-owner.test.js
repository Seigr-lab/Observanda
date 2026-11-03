import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomBytes,randomUUID} from 'node:crypto';
import {Workspace} from '../src/storage.js';
import {WebsiteFileStore} from '../src/website-file-store.js';
import {closeIdleMutationFiles} from '../src/mutation-files.js';
import {seedWebsitePickerCorpus} from './helpers/website-picker-corpus.js';
import {enumerateFeedMembers,readFeedSource} from '../src/website-feed-query.js';
import {feedOwnerDeletionHooks} from '../src/website-feed-owner.js';

test('a frozen lab-book or project retires only its live members, with a persistent fence through interruption',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'feed-owner-'));await mkdir(path.join(root,'.observanda'));
 t.after(async()=>{await closeIdleMutationFiles();await rm(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 const store=new WebsiteFileStore(new Workspace(root,{id:randomUUID(),key:randomBytes(32)})),{projects,books,examples}=await seedWebsitePickerCorpus(store,{count:6});
 const project=projects[0],book=books[0],hooks=feedOwnerDeletionHooks(store),receipt={id:randomUUID(),namespaceId:store.workspace.vault.id,projectId:project.id,labBookId:book.id};
 const site=await store.create({name:'Fixed collection'}),placed=await store.insertSource(site.site.id,{sourceId:examples[0].id,expectedRevision:site.site.revision});
 await hooks.beforeFreeze(receipt);await assert.rejects(enumerateFeedMembers(store,{}),{code:'CONFLICT'});
 const write=store.writeControl;store.writeControl=function(name,data,options){if(name.includes('/feed-deletions/')&&data.complete)throw Error('Interrupted before clearing fence');return write.call(store,name,data,options);};
 await assert.rejects(hooks.onFrozen(receipt),/Interrupted before clearing fence/);store.writeControl=write;
 await assert.rejects(enumerateFeedMembers(store,{}),{code:'CONFLICT'});
 await hooks.onFrozen(receipt);
 assert.equal((await enumerateFeedMembers(store,{})).length,5);await store.scope(()=>assert.rejects(readFeedSource(store,examples[0].id),{code:'NOT_FOUND'}));assert.equal((await store.open(site.site.id)).html,placed.html);
 const projectReceipt={id:randomUUID(),projectId:project.id,namespaceId:randomUUID()};await hooks.beforeFreeze(projectReceipt);await hooks.onFrozen(projectReceipt);await hooks.onFrozen(projectReceipt);
 const remaining=await enumerateFeedMembers(store,{});assert.equal(remaining.length,4);assert.ok(!remaining.some(m=>m.id===examples[1].id));
});
