import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {refuseNewerFormat} from '../src/stored-format.js';
import {readAccess} from '../src/access.js';
import {catalogueActivation,CATALOGUE_ACTIVATION} from '../src/postgres-activation.js';
import {validatePublicationStarter} from '../src/pdf-publication-starters.js';
import {moveSource,MOVE_SOURCE} from '../src/workspace-move-state.js';
import {workspaceDeletion,DELETE_MARKER} from '../src/workspace-delete-state.js';
import {seal,unseal} from '../src/encryption.js';
import {randomBytes} from 'node:crypto';

// A workspace or file saved by a newer release must be refused as newer, with its
// files unchanged, so an older installation never calls it damaged or earlier.
async function folder(t){
 const root=await mkdtemp(path.join(os.tmpdir(),'observanda-newer-format-'));t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(path.join(root,'.observanda'));return root;
}

test('only a version above the newest known one is refused as newer',()=>{
 assert.throws(()=>refuseNewerFormat(4,3),{code:'STORAGE_NEWER'});
 for(const version of [3,2,1,0,undefined,null,'4',4.5])assert.doesNotThrow(()=>refuseNewerFormat(version,3));
});

test('workspace files from a newer release are refused as newer and left unchanged',async t=>{
 const root=await folder(t),access=path.join(root,'.observanda','access.json'),raw=JSON.stringify({formatVersion:4,vaultId:randomUUID()});
 await writeFile(access,raw);
 await assert.rejects(readAccess(root),{code:'STORAGE_NEWER'});assert.equal(await readFile(access,'utf8'),raw);
 await writeFile(access,JSON.stringify({formatVersion:2}));await assert.rejects(readAccess(root),{code:'ACCESS_FORMAT'});
 const activation=path.join(root,CATALOGUE_ACTIVATION),marker=JSON.stringify({format:'observanda-postgresql-activation',version:2,id:randomUUID()});
 await writeFile(activation,marker);
 await assert.rejects(catalogueActivation(root),{code:'STORAGE_NEWER'});assert.equal(await readFile(activation,'utf8'),marker);
 await writeFile(activation,JSON.stringify({format:'observanda-postgresql-activation',version:1,id:'not an id'}));await assert.rejects(catalogueActivation(root),{code:'CATALOGUE_DAMAGED'});
 // Operation markers: a later release that extends one adds a version above the current one.
 const id=randomUUID(),destination=path.join(root,'Moved');
 await writeFile(path.join(root,MOVE_SOURCE),JSON.stringify({version:2,id,destination}));await assert.rejects(moveSource(root),{code:'STORAGE_NEWER'});
 await writeFile(path.join(root,MOVE_SOURCE),JSON.stringify({id,destination,extra:true}));await assert.rejects(moveSource(root),{code:'STORAGE_MOVE_STATE'});
 await writeFile(path.join(root,MOVE_SOURCE),JSON.stringify({id,destination}));assert.deepEqual(await moveSource(root),{id,destination});
 await writeFile(path.join(root,DELETE_MARKER),JSON.stringify({version:2,id,source:root}));await assert.rejects(workspaceDeletion(root),{code:'STORAGE_NEWER'});
});

test('a publication starter from a newer release is refused as newer',()=>{
 assert.throws(()=>validatePublicationStarter({format:'observanda-publication-starter',version:2},{checkFont:false}),{code:'STORAGE_NEWER'});
 assert.throws(()=>validatePublicationStarter({format:'observanda-publication-starter',version:1},{checkFont:false}),error=>error.code!=='STORAGE_NEWER');
});

test('an encryption envelope from a newer release is refused as newer, a damaged one as damaged',()=>{
 const key=randomBytes(32),sealed=seal(Buffer.from('Exact observation'),key,'test');
 assert.equal(unseal(sealed,key,'test').toString(),'Exact observation');
 const newer=Buffer.from(sealed);newer.write('OBSENC03',0,'latin1');assert.throws(()=>unseal(newer,key,'test'),{code:'STORAGE_NEWER'});
 const damaged=Buffer.from(sealed);damaged[40]^=1;assert.throws(()=>unseal(damaged,key,'test'),{code:'ENCRYPTION_DAMAGED'});
});

test('per-computer files from a newer release are refused as newer and kept',async t=>{
 const {preferencesSnapshot}=await import('../src/preferences.js'),{DeviceStore}=await import('../src/security/device-store.js');
 const root=await folder(t),preferences=path.join(root,'preferences.json'),device=path.join(root,'device.json');
 await writeFile(preferences,JSON.stringify({formatVersion:2,language:'en'}));await assert.rejects(preferencesSnapshot(preferences),{code:'STORAGE_NEWER'});
 await writeFile(preferences,JSON.stringify({formatVersion:1,unknown:true}));await assert.rejects(preferencesSnapshot(preferences),{code:'PREFERENCES_FORMAT'});
 const raw=JSON.stringify({format:2,public:{}});await writeFile(device,raw);
 await assert.rejects(new DeviceStore({file:device}).read(),{code:'STORAGE_NEWER'});assert.equal(await readFile(device,'utf8'),raw);
 await writeFile(device,JSON.stringify({format:1,public:{}}));await assert.rejects(new DeviceStore({file:device}).read(),{code:'DEVICE_INVALID'});
});
