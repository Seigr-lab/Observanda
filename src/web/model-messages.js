import {translator} from './i18n/runtime.js';

const english=new WeakMap();
// Shared models keep deterministic English output by default. Browser owners
// may supply an explicit translator for their presentation of the same result.
export function modelMessages(namespace,catalogue,translate){
 if(translate)return (key,values)=>translate(namespace,key,values);
 if(!english.has(catalogue))english.set(catalogue,translator('en',catalogue));
 return english.get(catalogue);
}
