import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {TestDeviceStore} from '../device-fixture.js';
import {createWorkspaceAccess,takeCreatedVault} from '../../src/access.js';
import {initializeLocation} from '../../src/locations.js';
import {Workspace} from '../../src/storage.js';
export async function encryptedFixture(directory,book,options,{deviceDirectory=directory}={}){
 await mkdir(directory,{recursive:true});
 const root=path.join(directory,'workspace'),deviceStore=new TestDeviceStore({file:path.join(deviceDirectory,'device.key')}),access=await createWorkspaceAccess('','',deviceStore),vault=takeCreatedVault(access);
 await initializeLocation(root,book,access,vault,options);return {workspace:new Workspace(root,vault),vault,deviceStore};
}
