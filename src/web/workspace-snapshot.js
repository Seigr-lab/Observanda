// Saved record bodies are owned immutable values. Drafts share them until an
// editor requests a mutable copy; metadata has its own independent lifecycle.
// Only records retained here are shareable, not arbitrary frozen caller objects.
import {sameJSONData} from './json-data-equality.js';
const retained=new WeakSet();
function freeze(value){
 if(value&&typeof value==='object'&&!Object.isFrozen(value)){
  for(const child of Object.values(value))freeze(child);
  Object.freeze(value);
 }
 return value;
}
export function retainRecord(record){
 if(retained.has(record))return record;
 return retainOwnedRecord(structuredClone(record));
}
// Only for a detached API response or checkpoint whose caller transfers
// ownership. Ordinary callers keep the defensive clone in retainRecord().
export function retainOwnedRecord(record){const saved=freeze(record);retained.add(saved);return saved;}
export function snapshotWorkspace(book){
 if(!book)return book;
 const {entries,...metadata}=book;
 return {...structuredClone(metadata),entries:entries.map(retainRecord)};
}
export function draftWorkspace(book){
 if(!book)return book;
 const {entries,...metadata}=book;
 return {...structuredClone(metadata),entries:entries.map(record=>retained.has(record)?record:structuredClone(record))};
}
export function editableRecord(book,id){
 const index=book?.entries.findIndex(record=>record.id===id)??-1;
 if(index<0)return undefined;
 const record=book.entries[index];
 if(retained.has(record))book.entries[index]=structuredClone(record);
 return book.entries[index];
}
export const sameValue=sameJSONData;
export function sameWorkspace(before,after){
 if(before===after)return true;
 if(!before||!after)return false;
 for(const key of new Set([...Object.keys(before),...Object.keys(after)])){
  if(key!=='entries'&&!sameValue(before[key],after[key]))return false;
 }
 return before.entries.length===after.entries.length&&before.entries.every((record,i)=>sameValue(record,after.entries[i]));
}
