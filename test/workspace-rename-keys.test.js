import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID,randomBytes} from 'node:crypto';
import {Workspace} from '../src/storage.js';
import {clearVault,encrypted} from '../src/encryption.js';
import {saveRenameKeys,loadRenameKeys,RENAME_KEYS_FILE} from '../src/workspace-rename-keys.js';
test('rename recovery keys require encryption and authenticate the workspace and operation',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-rename-keys-')),vault={id:randomUUID(),key:randomBytes(32)},key={id:randomUUID(),key:randomBytes(32)},projectId=randomUUID(),id=randomUUID(),keys=new Map([[projectId,key]]),workspace=new Workspace(root,vault);
 t.after(async()=>{clearVault(vault);clearVault(key);assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('observanda-rename-keys-'));await rm(root,{recursive:true,force:true});});
 await mkdir(path.join(root,'.observanda'));await assert.rejects(saveRenameKeys(new Workspace(root),id,keys),{code:'ACCESS_LOCKED'});
 const receipt=await saveRenameKeys(workspace,id,keys),file=path.join(root,RENAME_KEYS_FILE),stored=await readFile(file);assert.ok(encrypted(stored));assert.ok(!stored.includes(key.key));assert.ok(!stored.includes(Buffer.from(key.key.toString('base64'))));
 const reopened=await loadRenameKeys(workspace,id,receipt);assert.deepEqual(reopened.get(projectId),key);for(const value of reopened.values())clearVault(value);
 await assert.rejects(loadRenameKeys(workspace,randomUUID(),receipt),{code:'ENCRYPTION_DAMAGED'});
 const wrong={id:randomUUID(),key:randomBytes(32)};try{await assert.rejects(loadRenameKeys(new Workspace(root,wrong),id,receipt),{code:'ENCRYPTION_DAMAGED'});}finally{clearVault(wrong);}
 stored[stored.length-1]^=1;await writeFile(file,stored);await assert.rejects(loadRenameKeys(workspace,id,receipt),{code:'STORAGE_RENAME_STATE'});
});
