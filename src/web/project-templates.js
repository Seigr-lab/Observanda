import {emptyConfiguration,validConfiguration} from './notebook-schema.js';
import {profileById,enableProfile} from './laboratory/catalog.js';
import {enabledLabBookTypes} from './feature-modules.js';

export const projectTypeChoices=settings=>enabledLabBookTypes(settings).map(p=>({id:'profile:'+p.id,label:p.label}));
export const projectTypeChoice=(kind,settings)=>!kind||kind==='Project'?'none':projectTypeChoices(settings).find(choice=>choice.label===kind)?.id??'custom';
export const recommendedProfile=(choice,settings)=>choice.startsWith('profile:')?enabledLabBookTypes(settings).find(p=>p.id===choice.slice(8))??null:null;
export const validLabBookTemplate=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===2&&typeof value.name==='string'&&!!value.name.trim()&&value.name.length<=160&&!/[\x00-\x1f]/.test(value.name)&&validConfiguration(value.configuration);
export function copyConfiguration(configuration){
 const copy=structuredClone(configuration);
 for(const section of copy.sections)section.id=crypto.randomUUID();
 return copy;
}
export function starterTemplate(id){
 const profile=profileById(id);if(!profile)throw new TypeError('Unknown lab-book type');
 const configuration=emptyConfiguration();enableProfile(configuration,id,true);
 return {name:profile.label,configuration};
}
export const templateAvailable=(template,settings)=>!!template&&template.configuration.profiles.filter(p=>p.enabled).every(p=>enabledLabBookTypes(settings).some(active=>active.id===p.id));
export const newLabBookConfiguration=(template,settings)=>templateAvailable(template,settings)?copyConfiguration(template.configuration):emptyConfiguration();
export const templateChoices=(book,settings)=>book.projects.filter(p=>templateAvailable(p.labBookTemplate,settings)).map(p=>({id:p.id,label:p.labBookTemplate.name+' / '+p.title,template:p.labBookTemplate}));
