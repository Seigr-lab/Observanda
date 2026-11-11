import {t,language,loadedMessages,prepareNamespaces} from '../i18n/index.js';

// Lab book configurations and records keep a profile's canonical English text
// (profile-definition.js). Text that still equals a shipped default is shown in
// the interface language; text an author changed is theirs and is shown as
// written. Identical English text has one translation per language, so the
// text alone identifies its message wherever it was copied (records keep only
// labels, not the profile keys behind them).
// The catalogue is deferred: the interface prepares it with the workspace,
// before any lab book or record draws, and every other language loads it with
// its own messages (i18n prepareLanguage). Until it is loaded, English shows the
// canonical text as stored, which is exactly its English message.
export const prepareProfileText=()=>prepareNamespaces(['labBookProfiles']);
let keys=null;
function profileKeys(){
 if(keys)return keys;
 const english=loadedMessages('labBookProfiles');if(!english)return null;
 keys=new Map();for(const [key,value] of Object.entries(english))if(!keys.has(value))keys.set(value,key);
 return keys;
}
const loadedKeys=()=>{const found=profileKeys();if(!found)throw new TypeError('Message namespace has not been loaded: labBookProfiles');return found;};
export const isProfileText=value=>typeof value==='string'&&loadedKeys().has(value);
export const profileText=value=>{
 if(typeof value!=='string')return value;
 if(!profileKeys()&&language()==='en')return value;
 const found=loadedKeys();return found.has(value)?t('labBookProfiles',found.get(value)):value;
};
// A choice is also the value records store. An edited list of displayed
// choices maps every unchanged translation back to the stored choice, so a
// translated interface never renames the values existing records refer to.
export const storedChoices=(lines,previous)=>lines.map(line=>previous.find(choice=>choice===line||profileText(choice)===line)??line);
// Subject tracking labels belong to the profile that declares the subjects.
export const trackingText=(profileId,name,subject)=>t('labBookProfiles',profileId+'.tracking.'+(name==='history'?'history.'+subject:name));
// What an upgrade plan (catalog.js profileUpgrade) adds, in display text.
export const profileUpgradeItems=plan=>[
 ...plan.sections.map(s=>profileText(s.label)),
 ...plan.fields.map(({section,field})=>profileText(sectionLabel(plan,section))+': '+profileText(field.label)),
 ...plan.choices.map(({section,field,choice})=>profileText(fieldLabel(plan,section,field))+': '+profileText(choice)),
 ...(plan.private??[]).map(({section,field})=>profileText(fieldLabel(plan,section,field))+' ('+t('customFields','privateMark')+')')
];
const sectionLabel=(plan,key)=>plan.profile.sections.find(s=>s.key===key)?.label??key;
const fieldLabel=(plan,section,key)=>plan.profile.sections.find(s=>s.key===section)?.fields.find(f=>f.key===key)?.label??key;
// Property changes in display text (catalog.js profileUpgradeReview).
const shownValue=(property,value)=>property==='unit'?(value?profileText(value):t('configurationEditor','profileValueNone')):t('customFields',property==='format'?'formats.'+(value??'free'):'uncertainties.'+(value??'none'));
const changeField=(plan,change)=>profileText(fieldLabel(plan,change.section,change.field));
export const profileUpgradeChangeText=(plan,change)=>t('configurationEditor','profileUpgradeChange',{field:changeField(plan,change),property:t('configurationEditor','property.'+change.property),from:shownValue(change.property,change.from),to:shownValue(change.property,change.to)});
export const profileUpgradeKeptText=(plan,change)=>t('configurationEditor','profileUpgradeKept',{field:changeField(plan,change),property:t('configurationEditor','property.'+change.property),current:shownValue(change.property,change.current??null)});
// The reviewable list shown before a book adopts a newer profile version.
export function profileUpgradeSummary(plan,review,esc){
 const items=profileUpgradeItems(plan),list=(heading,lines)=>lines.length?'<p>'+esc(heading)+'</p><ul>'+lines.map(line=>'<li>'+esc(line)+'</li>').join('')+'</ul>':'';
 return '<div class="muted" data-profile-upgrade="'+esc(plan.profile.id)+'">'+(items.length?'<p>'+esc(t('configurationEditor','profileUpgradeAdds',{version:plan.to,items:items.join(', ')}))+'</p>':'')+
  (review?list(t('configurationEditor','profileUpgradeUpdates'),review.apply.map(change=>profileUpgradeChangeText(plan,change)))+list(t('configurationEditor','profileUpgradeKeptHeading'),review.kept.map(change=>profileUpgradeKeptText(plan,change))):list(t('configurationEditor','profileUpgradeUpdates'),plan.changes.map(change=>profileUpgradeChangeText(plan,change))))+
  '<p>'+esc(t('configurationEditor','profileUpgradeKeeps'))+'</p></div>';
}
