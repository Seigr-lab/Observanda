import '../i18n/catalogues/labBookProfiles.js';
import english from '../locales/en/labBookProfiles.json' with {type:'json'};
import {t} from '../i18n/index.js';

// Lab book configurations and records keep a profile's canonical English text
// (profile-definition.js). Text that still equals a shipped default is shown in
// the interface language; text an author changed is theirs and is shown as
// written. Identical English text has one translation per language, so the
// text alone identifies its message wherever it was copied (records keep only
// labels, not the profile keys behind them).
const keys=new Map();
for(const [key,value] of Object.entries(english))if(!keys.has(value))keys.set(value,key);
export const isProfileText=value=>typeof value==='string'&&keys.has(value);
export const profileText=value=>isProfileText(value)?t('labBookProfiles',keys.get(value)):value;
// A choice is also the value records store. An edited list of displayed
// choices maps every unchanged translation back to the stored choice, so a
// translated interface never renames the values existing records refer to.
export const storedChoices=(lines,previous)=>lines.map(line=>previous.find(choice=>choice===line||profileText(choice)===line)??line);
export const storedChoice=(line,previous)=>storedChoices([line],previous)[0];
// Subject tracking labels belong to the profile that declares the subjects.
export const trackingText=(profileId,name,subject)=>t('labBookProfiles',profileId+'.tracking.'+(name==='history'?'history.'+subject:name));
