import path from 'node:path';
import {mkdir} from 'node:fs/promises';
import {MediaStore} from '../src/media.js';

// Synthetic catalogue fixtures must contain the evidence they reference.
// Convert once, then retain independently identified, encrypted originals and
// display copies for discovery tests which require many attachment identities.
export async function populateImageEvidence(workspace,ids){
 ids=[...new Set(ids)];if(!ids.length)return;
 const media=new MediaStore(workspace.root,workspace.vault),asset=await media.import(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="black"/></svg>'),'image');
 const source=await media.metadata(asset.id),original=await workspace.readFile(path.join(source.directory,'original')),display=await workspace.readFile(path.join(source.directory,'public.png'));
 for(const id of ids){
  const target=path.join(workspace.root,'.observanda/media',id);await mkdir(target,{mode:0o700});
  await workspace.writeFile(path.join(target,'original'),original);await workspace.writeFile(path.join(target,'public.png'),display);
  await workspace.writeFile(path.join(target,'asset.json'),JSON.stringify({...source.metadata,id}));
 }
}
