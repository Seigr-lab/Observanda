import {researchId} from './research-reference.js';
import {revisionId} from './revision-model.js';
export {validWebsitePage,validWebsiteNavigationItem,validWebsiteAsset} from './website-item-validation.js';
export const WEBSITE_COLLECTION_PATHS=Object.freeze({pages:Object.freeze(['document','pages']),navigation:Object.freeze(['document','website','navigation']),assets:Object.freeze(['document','website','assets'])});
export const websiteCollectionName=value=>typeof value==='string'&&Object.hasOwn(WEBSITE_COLLECTION_PATHS,value);
export const websiteCollectionKey=(collection,value)=>collection==='navigation'?value?.target:value?.id;
export const validWebsiteCollectionKey=(collection,key)=>collection==='navigation'?typeof key==='string'&&/^(home|(?:project|notebook|page):[a-f0-9-]{36})$/.test(key):researchId(key);
export function websiteSettingPath(path){
 if(!Array.isArray(path)||!path.length||path.some(part=>typeof part!=='string'||['__proto__','prototype','constructor'].includes(part)))return false;
 if(path.length===1)return ['name','projects','selection'].includes(path[0]);
 if(path[0]!=='document')return false;
 if(['branding','appearance','themes','activeThemeId'].includes(path[1]))return true;
 return path[1]==='website'&&path.length>=3&&!['navigation','assets'].includes(path[2]);
}
export function validWebsiteEditorOperation(value){
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const exact=keys=>Object.keys(value).every(key=>keys.includes(key));
 if(value.type==='settings')return exact(['type','path','value','remove'])&&websiteSettingPath(value.path)&&(value.remove===true?!Object.hasOwn(value,'value'):value.remove===undefined&&Object.hasOwn(value,'value'));
 if(value.type==='replace')return exact(['type','collection','key','position','expectedItemRevision','value'])&&websiteCollectionName(value.collection)&&validWebsiteCollectionKey(value.collection,value.key)&&(value.position===undefined||Number.isSafeInteger(value.position)&&value.position>=0)&&(value.expectedItemRevision===undefined||revisionId(value.expectedItemRevision))&&Object.hasOwn(value,'value')&&websiteCollectionKey(value.collection,value.value)===value.key;
 if(value.type==='append')return exact(['type','collection','values'])&&websiteCollectionName(value.collection)&&Array.isArray(value.values)&&value.values.length>0&&value.values.length<=32;
 if(['page-remove','asset-remove'].includes(value.type))return exact(['type','key','position','expectedItemRevision'])&&researchId(value.key)&&(value.position===undefined||Number.isSafeInteger(value.position)&&value.position>=0)&&(value.expectedItemRevision===undefined||revisionId(value.expectedItemRevision));
 if(value.type==='navigation-move')return exact(['type','key','beforeKey'])&&validWebsiteCollectionKey('navigation',value.key)&&(value.beforeKey===null||validWebsiteCollectionKey('navigation',value.beforeKey))&&value.key!==value.beforeKey;
 return ['menu-clear','home-remove'].includes(value.type)&&exact(['type']);
}
