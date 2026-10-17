import {AppError} from './errors.js';
import {revisionId} from './web/revision-model.js';
import {validWebsitePin} from './web/website-pin.js';
export {validWebsitePin,sameWebsitePin} from './web/website-pin.js';
import {websiteWorkspace} from './website-workspace.js';

// Research identities belong to the authenticated underlying owner, independent
// of the website's selected design. Preserve source-reader proxies unchanged.
export const publicationResearchWorkspace=workspace=>workspace.websiteContext?workspace.baseWorkspace:workspace;
export const publicationWorkspace=workspace=>workspace.websiteContext?workspace:websiteWorkspace(workspace,workspace.websiteId??null);
export function assertWebsitePin(workspace,pin,revision){
 if(!validWebsitePin(pin)||pin.researchSnapshotId!==revision||pin.websiteId!==(workspace.websiteId??null))throw new AppError('INVALID');
 return pin;
}
// An explicit research snapshot never selects a moving website head. Missing
// pins belong only to snapshots that still contain their exact inline document.
export async function publicationSnapshot(store,workspace,revision,pin){
 if(!revisionId(revision))throw new AppError('INVALID');
 if(pin!==undefined)assertWebsitePin(workspace,pin,revision);
 const snapshot=await store.snapshot(revision,pin===undefined?undefined:{websiteRevision:pin.websiteRevision});
 const resolved=assertWebsitePin(workspace,snapshot.websitePin,revision);
 if(snapshot.websiteDocuments===1&&(pin===undefined||resolved.websiteRevision===null)||pin!==undefined&&resolved.websiteRevision!==pin.websiteRevision)throw new AppError('INVALID');
 return snapshot;
}
export async function retainedWebsitePin(workspace,source){
 if(source.websitePin!==undefined){const pin=assertWebsitePin(workspace,source.websitePin,source.etag);if(pin.websiteRevision!==null)return pin;}
 if(await workspace.storageKind()!=='catalogue')return assertWebsitePin(workspace,{researchSnapshotId:source.etag,websiteId:workspace.websiteId??null,websiteRevision:null},source.etag);
 return workspace.catalogue(async store=>(await publicationSnapshot(store,workspace,source.etag,source.websitePin)).websitePin);
}
