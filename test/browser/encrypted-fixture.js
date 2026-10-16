import path from 'node:path';
import {TestDeviceStore} from '../device-fixture.js';
import {createWorkspaceAccess,takeCreatedVault} from '../../src/access.js';
import {initializeLocation} from '../../src/locations.js';
import {Workspace} from '../../src/storage.js';
export async function encryptedFixture(directory,book,options){
 const root=path.join(directory,'workspace'),deviceStore=new TestDeviceStore({file:path.join(directory,'device.key')}),access=await createWorkspaceAccess('','',deviceStore),vault=takeCreatedVault(access);
 await initializeLocation(root,book,access,vault,options);return {workspace:new Workspace(root,vault),vault,deviceStore};
}
