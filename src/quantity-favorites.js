import {researchId} from './web/research-reference.js';
import {validMaterialReference,materialReferenceKey} from './web/material-reference.js';
import {revisionId} from './web/revision-model.js';
import {digest} from './storage-format.js';
import {exact} from './modules/validation.js';

// Device preferences contain addresses only. Labels and definitions are
// supplied by the authorized book when its picker is opened.
export function validQuantityChoice(choice,namespace){
 if(!choice||!researchId(namespace))return false;
 if(exact(choice,['catalogue','id','revision']))return choice.catalogue==='observanda-units'&&typeof choice.id==='string'&&/^[a-z][a-z0-9-]{0,79}$/.test(choice.id)&&Number.isSafeInteger(choice.revision)&&choice.revision>0;
 return exact(choice,['kind','id','revision','workspaceId'])&&validMaterialReference(choice)&&choice.kind==='analysis'&&choice.workspaceId===namespace;
}

export function quantityFavoriteKey(namespace,choice){
 const address=choice.catalogue?[choice.catalogue,choice.id,choice.revision]:materialReferenceKey(choice);
 return digest(JSON.stringify([namespace,address]));
}

export function validQuantityFavorites(value){
 if(!Array.isArray(value))return false;
 const keys=new Set();
 return value.every(row=>{
  if(!exact(row,['namespace','choice'])||!validQuantityChoice(row.choice,row.namespace))return false;
  const key=quantityFavoriteKey(row.namespace,row.choice);
  if(keys.has(key))return false;keys.add(key);return true;
 });
}

export function favoriteQuantityPage(rows,namespace,after){
 if(!researchId(namespace)||after!==null&&!revisionId(after))throw new TypeError('Invalid quantity favorite page');
 const matches=rows.filter(row=>row.namespace===namespace).map(row=>({key:quantityFavoriteKey(namespace,row.choice),choice:row.choice})).filter(row=>after===null||row.key>after);
 matches.sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);
 const items=matches.slice(0,16);
 return {items,next:matches.length>items.length?items.at(-1).key:null};
}
