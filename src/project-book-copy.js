import {NativeProjectBookCopy} from './native-project-book-copy.js';
import {inspectArchivedOwnerDirectory} from './owner-directory-archive.js';
import {readProjectArchiveIdentity} from './project-archive.js';
// A project bundle contains independently transferred book owners. Membership
// is fixed for the command; ordinary writers in unrelated owners remain free.
import {ProjectBookOwners} from './project-book-owners.js';
import {LabBookRegistry} from './lab-book-registry.js';
export class ProjectBookCopy extends ProjectBookOwners{
 constructor(project){super(project,{busyCode:'STORAGE_PROJECT_BUSY',missingAccessCode:'ACCESS_LOCKED'});}
 async prepare(withBook,{portable=false}={}){this.withBook=withBook;this.native=new NativeProjectBookCopy(this);return this.native.prepare(withBook,{portable});}
 async using(operation){return this.native.using(operation);}
 async copied(target,receipt,{portable=false,archive=portable,onCopiedBook}={}){return this.native.copied(target,receipt,{portable,archive,onCopiedBook});}

 async targetRevision(target,portable){
  const registry=new LabBookRegistry(target);if(!portable)return registry.version();
  const identity=await readProjectArchiveIdentity(target.root,target.vault,{verify:false});
  return inspectArchivedOwnerDirectory(registry,identity.archiveDigest,view=>view.revision);
 }
 async copy(target,receipt,save,{portable=false,archive=portable,checkpoint=async()=>{}}={}){return this.native.copy(target,receipt,save,{portable,archive,checkpoint});}
}
