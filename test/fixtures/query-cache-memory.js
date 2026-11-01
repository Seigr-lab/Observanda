import {randomUUID} from 'node:crypto';
// A test-only byte adapter exercises the production encrypted external sort.
// Work counters remain independent of filesystem and database latency.
export function queryCacheMemoryFiles(_workspace,{check}){
 const files=new Map();return {id:randomUUID(),
  async read(file,at,size){check();return files.get(file).subarray(at,at+size);},
  async write(file,at,bytes){check();const before=files.get(file)??Buffer.alloc(0),next=Buffer.alloc(Math.max(before.length,at+bytes.length));before.copy(next);bytes.copy(next,at);files.set(file,next);},
  async truncate(file,size){files.set(file,(files.get(file)??Buffer.alloc(0)).subarray(0,size));},
  async finish(){check();},async assertNamed(){check();},async close(){files.clear();}
 };
}
