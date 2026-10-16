import {researchId} from './research-reference.js';
export const resultValueId=field=>typeof field==='string'&&field.startsWith('result:')&&researchId(field.slice(7))?field.slice(7):null;
