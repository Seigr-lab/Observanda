import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readdir,readFile} from 'node:fs/promises';
import path from 'node:path';

// UTF-8 text decoded once as Latin-1 and saved again shows as "Â·" or "â€”"
// in the interface. Product sources and catalogues must never contain it.
const root=path.resolve('src'),mojibake=/[ÂÃ][\u0080-¿]|â€/u;
async function* files(directory){
 for(const entry of await readdir(directory,{withFileTypes:true})){
  const file=path.join(directory,entry.name);
  if(entry.isDirectory()){if(entry.name!=='vendor')yield* files(file);}
  else if(/\.(?:js|json|css|html)$/.test(entry.name))yield file;
 }
}
test('product sources contain no doubly encoded text',async()=>{
 const found=[];
 for await(const file of files(root)){const text=await readFile(file,'utf8'),match=mojibake.exec(text);if(match)found.push(path.relative(root,file)+': '+JSON.stringify(text.slice(Math.max(0,match.index-20),match.index+20)));}
 assert.deepEqual(found,[]);
});
