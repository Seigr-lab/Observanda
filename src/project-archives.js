// Portable backup commands belong to the selected project. They reuse bounded
// transport and durable retry without opening other project owners.
import {ProjectCopies} from './project-copy.js';
import {readAccess} from './access.js';
import {authenticateKeyring} from './security/keyring.js';
import {AppError} from './errors.js';
export class ProjectArchives extends ProjectCopies{
 get directory(){return '.observanda/project-archives';}
 get kind(){return 'archive';}
 get portable(){return true;}
 async prepare(storage,options){
  const access=await readAccess(storage.root);authenticateKeyring(access.value,storage.vault);
  if(!access.value.password&&!access.value.recovery)throw new AppError('STORAGE_PORTABLE_PROJECT_ACCESS');
  await super.prepare(storage,{...options,portable:true});
 }
 transfer(storage,value,options){return super.transfer(storage,value,{...options,portable:true});}
 async run(storage,options){return {...await super.run(storage,options),portable:true};}
}
