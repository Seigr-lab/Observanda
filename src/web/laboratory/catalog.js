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
import software from './profiles/software-development.js';
import music from './profiles/music.js';
import history from './profiles/historical-research.js';
// One composition point. Profiles do not own persistence, editor, routing or permissions.
export const laboratoryProfiles=Object.freeze([p0,p1,p2,p3,p4,p5,p6,p7,arts,physical,audio,beekeeping,software,music,history].sort((a,b)=>a.label.localeCompare(b.label,'en',{sensitivity:'base'})));
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
// A book keeps the profile version it adopted. Upgrading adds only what later
// versions introduced: new sections, new fields of sections the book still has
// and new choices of select fields it still has. Labels, guidance, order,
// removed items and existing records are never changed (records keep the
// structure they were written with).
export function profileUpgrade(profile,from){
 const newer=version=>version>from,introduced=profile.introduced;
 const kept=profile.sections.filter(s=>!newer(introduced.sections[s.key]));
 return {profile,from,to:profile.version,
  sections:profile.sections.filter(s=>newer(introduced.sections[s.key])),
  fields:kept.flatMap(s=>s.fields.filter(f=>newer(introduced.fields[s.key+'/'+f.key])).map(field=>({section:s.key,field}))),
  choices:kept.flatMap(s=>s.fields.filter(f=>!newer(introduced.fields[s.key+'/'+f.key])).flatMap(f=>f.choices.filter(choice=>newer(introduced.choices[s.key+'/'+f.key+'/'+choice])).map(choice=>({section:s.key,field:f.key,choice}))))};
}
export function upgradeProfile(lab,id,profile=profileById(id)){
 const chosen=lab.profiles.find(p=>p.id===id);
 if(!profile||!chosen||chosen.version>=profile.version)return false;
 const plan=profileUpgrade(profile,chosen.version),find=key=>lab.sections.find(s=>s.profileId===id&&s.key===key);
 for(const starter of plan.sections)if(!find(starter.key))lab.sections.push({...structuredClone(starter),id:crypto.randomUUID(),profileId:id,enabled:true});
 for(const {section,field} of plan.fields){const target=find(section);if(target&&!target.fields.some(f=>f.key===field.key))target.fields.push(structuredClone(field));}
 for(const {section,field,choice} of plan.choices){const target=find(section)?.fields.find(f=>f.key===field);if(target?.type==='select'&&!target.choices.includes(choice))target.choices.push(choice);}
 chosen.version=profile.version;return true;
}
