import path from 'node:path';
import {cp,writeFile} from 'node:fs/promises';
import {migrationFixture} from './migration-fixture.js';

// Ten physical byte sets, not ten references to a single capture. The nested
// fixture manifests remain accounted-for originals rather than hidden files.
export async function migrationGrowthFixture(root,copies=10){
 const first=path.join(root,'batch-0'),base=await migrationFixture(first,{full:true}),objects=[];
 for(let i=0;i<copies;i++){
  const prefix='batch-'+i;if(i)await cp(first,path.join(root,prefix),{recursive:true,errorOnExist:true,force:false});
  for(const original of base.manifest.objects){
   const object=structuredClone(original);object.id=prefix+':'+object.id;
   object.files.forEach(f=>f.path=prefix+'/'+f.path);object.links.forEach(l=>l.id=prefix+':'+l.id);
   object.urls=object.urls.map(url=>url.replace('/book/','/'+prefix+'/book/'));objects.push(object);
  }
  const manifest=base.originals.get('inventory.observanda-source.json');
  objects.push({id:prefix+':manifest',revision:'r1',kind:'artifact',title:prefix+' source declaration',disposition:'map',mapping:{kind:'artifact'},audience:'private',dates:[],urls:[],links:[],files:[{...manifest,path:prefix+'/'+manifest.path,selector:{kind:'whole'}}]});
 }
 const manifest={...base.manifest,source:{namespace:'synthetic:growth',revision:'r1',title:'Tenfold source inventory'},objects};
 const text=JSON.stringify(manifest,null,2)+'\n';await writeFile(path.join(root,'inventory.observanda-source.json'),text);
 return {objects:base.expected.objects*copies+copies,files:base.expected.files*copies+1,bytes:[...base.originals.values()].reduce((n,f)=>n+f.bytes,0)*copies+Buffer.byteLength(text),mapped:base.expected.mapped*copies+copies,excluded:copies};
}
