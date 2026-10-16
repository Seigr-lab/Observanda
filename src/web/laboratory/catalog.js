import beekeeping from './profiles/beekeeping.js';
import physical from './profiles/physical-prototyping.js';
import audio from './profiles/audio-software.js';
import p0 from './profiles/research-development.js';
import p1 from './profiles/clinical-medical.js';
import p2 from './profiles/analytical-qc.js';
import p3 from './profiles/educational.js';
import p4 from './profiles/biosafety-containment.js';
import p5 from './profiles/environmental-agricultural.js';
import p6 from './profiles/computer-it.js';
import p7 from './profiles/crime-forensic.js';
import arts from './profiles/arts-creative.js';
// One composition point. Profiles do not own persistence, editor, routing or permissions.
export const laboratoryProfiles=Object.freeze([p0,p1,p2,p3,p4,p5,p6,p7,arts,physical,audio,beekeeping].sort((a,b)=>a.label.localeCompare(b.label,'en',{sensitivity:'base'})));
export const profileById=id=>laboratoryProfiles.find(p=>p.id===id);
export const sectionAvailable=(lab,section)=>section.enabled&&(!section.profileId||lab.profiles.some(p=>p.id===section.profileId&&p.enabled));
export const availableSections=lab=>lab.sections.filter(s=>sectionAvailable(lab,s));
export function enableProfile(lab,id,enabled){
 const profile=profileById(id);if(!profile)return;
 let chosen=lab.profiles.find(p=>p.id===id);
 if(!chosen){chosen={id,version:profile.version,enabled};lab.profiles.push(chosen);}else chosen.enabled=enabled;
 // Re-enabling never replaces labels, field schemas or section ordering.
 if(enabled)for(const starter of profile.sections)if(!lab.sections.some(s=>s.profileId===id&&s.key===starter.key))
  lab.sections.push({...structuredClone(starter),id:crypto.randomUUID(),profileId:id,enabled:true});
}

export const laboratoryModuleId=profileId=>'laboratory-'+profileId;
