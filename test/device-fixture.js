// Test-only secret-store adapter. Production has no in-memory/plaintext fallback.
// Exercise real DPAPI on Windows; simulate an OS secret store on other CI platforms.
import {randomBytes} from 'node:crypto';
import {mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {DeviceStore,WindowsProtector} from '../src/security/device-store.js';
import {seal,unseal} from '../src/encryption.js';
import {startServer} from '../src/server.js';
const secrets=new Map();
export class TestDeviceStore extends DeviceStore{
 constructor(options){
  let protector=options.protector;
  if(!protector&&process.platform==='win32')protector=new WindowsProtector();
  if(!protector){
   if(!secrets.has(options.file))secrets.set(options.file,randomBytes(32));
   const secret=secrets.get(options.file);
   protector={available:()=>true,protect:async bytes=>seal(bytes,secret,'CI secret store'),unprotect:async bytes=>unseal(bytes,secret,'CI secret store')};
  }
  super({...options,protector});
 }
}
export async function testServer(options={}){
 const file=options.preferencesFile?options.preferencesFile+'.device-key':options.root?options.root+'.test-device-key':path.join(await mkdtemp(path.join(os.tmpdir(),'observanda-device-fixture-')),'device');
 return startServer({...options,deviceStore:options.deviceStore??new TestDeviceStore({file})});
}
