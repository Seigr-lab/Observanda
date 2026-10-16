import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,copyFile,stat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID,randomBytes} from 'node:crypto';
import {Workspace} from '../src/storage.js';
import {clearVault,encrypted} from '../src/encryption.js';
import {saveOwnerKeys,loadOwnerKeys,MOVE_BOOK_KEYS_FILE,DELETE_BOOK_KEYS_FILE} from '../src/owned-operation-keys.js';
import {clearMoveBookKeys} from '../src/project-book-move.js';
import {MOVE_SOURCE,assertNotMoving} from '../src/workspace-move-state.js';
import {assertRenameDatabaseOwners} from '../src/workspace-rename-inventory.js';

test('move capabilities are encrypted and bound to operation, destination key and lifecycle purpose',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-move-capabilities-')),vault={id:randomUUID(),key:randomBytes(32)},key={id:randomUUID(),key:randomBytes(32)},bookId=randomUUID(),id=randomUUID(),keys=new Map([[bookId,key]]),workspace=new Workspace(root,vault);
 t.after(async()=>{clearVault(vault);clearVault(key);assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('observanda-move-capabilities-'));await rm(root,{recursive:true,force:true});});
 await mkdir(path.join(root,'.observanda'));await assert.rejects(saveOwnerKeys(new Workspace(root),id,keys,MOVE_BOOK_KEYS_FILE),{code:'ACCESS_LOCKED'});
 const hash=await saveOwnerKeys(workspace,id,keys,MOVE_BOOK_KEYS_FILE),file=path.join(root,MOVE_BOOK_KEYS_FILE),stored=await readFile(file);assert.ok(encrypted(stored));assert.ok(!stored.includes(key.key));
 const reopened=await loadOwnerKeys(workspace,id,hash,MOVE_BOOK_KEYS_FILE);assert.deepEqual(reopened.get(bookId),key);for(const value of reopened.values())clearVault(value);
 await assert.rejects(loadOwnerKeys(workspace,randomUUID(),hash,MOVE_BOOK_KEYS_FILE),{code:'ENCRYPTION_DAMAGED'});
 await copyFile(file,path.join(root,DELETE_BOOK_KEYS_FILE));await assert.rejects(loadOwnerKeys(workspace,id,hash,DELETE_BOOK_KEYS_FILE),{code:'ENCRYPTION_DAMAGED'});
 const wrong={id:randomUUID(),key:randomBytes(32)};try{await assert.rejects(loadOwnerKeys(new Workspace(root,wrong),id,hash,MOVE_BOOK_KEYS_FILE),{code:'ENCRYPTION_DAMAGED'});}finally{clearVault(wrong);}
 stored[stored.length-1]^=1;await writeFile(file,stored);await assert.rejects(clearMoveBookKeys(workspace,{bookKeysHash:hash}),{code:'STORAGE_MOVE_STATE'});assert.ok(await stat(file));
 const latest=await saveOwnerKeys(workspace,id,keys,MOVE_BOOK_KEYS_FILE);await clearMoveBookKeys(workspace,{bookKeysHash:latest});await clearMoveBookKeys(workspace,{bookKeysHash:latest});await assert.rejects(stat(file),{code:'ENOENT'});
});

test('a project move fences only its declared books and does not inspect independent child databases',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-move-boundary-')),id=randomUUID(),book=path.join(root,'Book 1'),child=path.join(root,'Child Project'),unknown=path.join(book,'Unexpected owner');
 t.after(async()=>{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('observanda-move-boundary-'));await rm(root,{recursive:true,force:true});});
 for(const owner of [root,book,child])await mkdir(path.join(owner,'.observanda/postgresql'),{recursive:true});await writeFile(path.join(root,MOVE_SOURCE),JSON.stringify({id,destination:path.join(path.dirname(root),'Destination'),books:['Book 1']}));
 await assert.rejects(assertNotMoving(root),{code:'STORAGE_MOVED'});await assert.rejects(assertNotMoving(book),{code:'STORAGE_MOVED'});await assertNotMoving(book,id);await assertNotMoving(child);
 await assertRenameDatabaseOwners(root,[book],{skipRoots:[child]});await mkdir(path.join(unknown,'.observanda/postgresql'),{recursive:true});await assert.rejects(assertRenameDatabaseOwners(root,[book],{skipRoots:[child],errorCode:'STORAGE_MOVE_CONTENTS'}),{code:'STORAGE_MOVE_CONTENTS'});
});
