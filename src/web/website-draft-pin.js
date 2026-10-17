import {researchId} from './research-reference.js';
import {revisionId} from './revision-model.js';
export const validWebsiteDraftPin=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join()==='id,revision'&&researchId(value.id)&&revisionId(value.revision);
