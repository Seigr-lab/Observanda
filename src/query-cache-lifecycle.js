import path from 'node:path';
const roots=new Map(),identity=root=>process.platform==='win32'?path.resolve(root).toLowerCase():path.resolve(root);
const contains=(parent,child)=>child===parent||child.startsWith(parent.endsWith(path.sep)?parent:parent+path.sep);
const forget=(key,value)=>{if(!value.suspended&&!value.entries.size&&roots.get(key)===value)roots.delete(key);};
export const queryCacheSuspended=root=>{const key=identity(root);return [...roots].some(([parent,value])=>value.suspended&&contains(parent,key));};
export function registerQueryCacheRoot(root,retire){
 if(queryCacheSuspended(root))return null;const key=identity(root);let value=roots.get(key);if(!value){value={suspended:0,entries:new Set()};roots.set(key,value);}
 value.entries.add(retire);return ()=>{value.entries.delete(retire);forget(key,value);};
}
export async function withQueryCacheHandoff(root,operation){
 const key=identity(root);let value=roots.get(key);if(!value){value={suspended:0,entries:new Set()};roots.set(key,value);}value.suspended++;
 try{const entries=[...roots].filter(([child])=>contains(key,child)).flatMap(([,held])=>[...held.entries]),results=await Promise.allSettled(entries.map(retire=>retire()));const failed=results.find(result=>result.status==='rejected');if(failed)throw failed.reason;return await operation();}
 finally{value.suspended--;forget(key,value);}
}
