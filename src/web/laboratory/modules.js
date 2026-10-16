
import {laboratoryProfiles,laboratoryModuleId} from './catalog.js';
// Domains contribute notebook templates, settings and data providers.
// Ownership, records and navigation belong to the shared workspace structure.
export const laboratoryModules=laboratoryProfiles.map(profile=>({
 id:laboratoryModuleId(profile.id),labBookType:profile,parentId:'research',defaultPage:'projects',label:profile.label,
 entityTypes:[],metadataOnly:true,
 description:profile.description,settingsLabel:'Record types',pages:[],
 createSettings:services=>import('./record-type-settings.js').then(m=>m.recordTypeSettings(services,profile)),
 navigation:[],
 load:()=>import('./workspace-data.js').then(m=>registry=>m.registerLabWorkspaceData(registry,{profile}))
}));
