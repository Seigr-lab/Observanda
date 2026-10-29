import {t,language} from './i18n/index.js';
import './i18n/catalogues/websiteAuthoring.js';
import './i18n/catalogues/supportEditors.js';
import './i18n/catalogues/repositorySetup.js';
import './i18n/catalogues/githubTransfer.js';
import authoringMessages from './locales/en/websiteAuthoring.json' with {type:'json'};
import publicationMessages from './locales/en/publication.json' with {type:'json'};
import setupMessages from './locales/en/repositorySetup.json' with {type:'json'};
import transferMessages from './locales/en/githubTransfer.json' with {type:'json'};
import errorMessages from './locales/en/errors.json' with {type:'json'};

// Workers retain canonical stages. Translate only known protocol text for display.
const messageKeys=new Map();
for(const [namespace,messages]of [['websiteAuthoring',authoringMessages],['publication',publicationMessages],['repositorySetup',setupMessages],['githubTransfer',transferMessages]])for(const [key,value]of Object.entries(messages))if(typeof value==='string'&&!value.includes('{')&&(namespace!=='websiteAuthoring'||key.startsWith('pub')))messageKeys.set(value,[namespace,key]);
const knownMessage=value=>{const entry=messageKeys.get(value);return entry?t(...entry):null;};
export function publishingMessage(value){
 const exact=knownMessage(value);if(exact!==null)return exact;
 if(typeof value!=='string')return value??'';
 const progress=value.match(/^(.*) \((\d+)\)$/);if(progress&&knownMessage(progress[1])!==null)return t('websiteAuthoring','pubProgressCount',{stage:knownMessage(progress[1]),count:Number(progress[2]).toLocaleString(language())});
 const verified=value.match(/^The live website is verified: all (\d+) files match the reviewed release; (\d+) removed URLs return not found\.$/);if(verified)return t('publication','liveVerified',{count:Number(verified[1]),removed:Number(verified[2])});
 const sentences=value.split(/(?<=\.) /),translated=sentences.map(knownMessage);return sentences.length>1&&translated.every(item=>item!==null)?translated.join(' '):value;
}
export const publishingError=error=>Object.hasOwn(errorMessages,error.code)?t('errors',error.code):publishingMessage(error.message);
export function publishingJobText(job){
 if(job.state==='relocated')return t('errors','JOB_RELOCATED');
 if(Object.hasOwn(errorMessages,job.error))return t('errors',job.error);
 const value=job.message??job.progress?.stage??job.state;
 if(['queued','running','completed','failed','cancelled','relocated'].includes(value))return t('supportEditors','state_'+value);
 return value==='preparing'?t('websiteAuthoring','pubPreparing'):publishingMessage(value);
}
