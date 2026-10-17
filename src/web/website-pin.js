import {revisionId} from './revision-model.js';
import {researchId} from './research-reference.js';

// Website content and selected research each have an immutable identity.
export function validWebsitePin(pin){
 return !!pin&&typeof pin==='object'&&!Array.isArray(pin)&&Object.keys(pin).sort().join()==='researchSnapshotId,websiteId,websiteRevision'&&revisionId(pin.researchSnapshotId)&&(pin.websiteId===null||researchId(pin.websiteId))&&(pin.websiteRevision===null||revisionId(pin.websiteRevision));
}
export const sameWebsitePin=(a,b)=>validWebsitePin(a)&&validWebsitePin(b)&&a.researchSnapshotId===b.researchSnapshotId&&a.websiteId===b.websiteId&&a.websiteRevision===b.websiteRevision;
