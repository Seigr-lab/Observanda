import {laboratoryProfiles,laboratoryModuleId} from './catalog.js';
import {configurationOf} from '../notebook-schema.js';
// Profile cards use the same canonical lab books and record queries as the
// generic dashboard. Enabling a template never creates a second record store.
const providers=new Map([{id:'lab',profile:null},...laboratoryProfiles.map(profile=>({id:laboratoryModuleId(profile.id),profile}))].map(({id,profile})=>[id+'-records',{profile}]));
export const labRecordProvider=id=>providers.get(id)??null;
export const labDataNotebooks=(notebooks,profile)=>notebooks.filter(n=>configurationOf(n).profiles.some(p=>p.enabled&&(!profile||p.id===profile.id)));
export const labDataRecord=(record,profile)=>!profile||record.template?.profileId===profile.id;
