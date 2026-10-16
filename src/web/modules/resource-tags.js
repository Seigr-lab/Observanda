// Tags classify resources; they never change ownership, stock or access.
export const resourceTagKey=value=>value.normalize('NFC').toLowerCase();
export function validResourceTags(value){
 return Array.isArray(value)&&value.length<=24&&value.every(tag=>typeof tag==='string'&&tag.length>0&&tag.length<=80&&tag===tag.trim()&&!/[,\u0000-\u001f\u007f]/u.test(tag))&&new Set(value.map(resourceTagKey)).size===value.length;
}
export function parseResourceTags(text){
 const result=[],seen=new Set();
 for(const value of text.split(',')){const tag=value.trim().normalize('NFC'),key=resourceTagKey(tag);if(tag&&!seen.has(key)){result.push(tag);seen.add(key);}}
 return result;
}
export function matchesResourceTags(saved,requested,mode='all'){
 const keys=new Set((saved??[]).map(resourceTagKey)),matches=tag=>keys.has(resourceTagKey(tag));
 return !requested.length||(mode==='any'?requested.some(matches):requested.every(matches));
}
