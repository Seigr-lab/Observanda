import {NativeWorkspaceProjectCopy} from './native-workspace-project-copy.js';
// A workspace copy includes its registered independent owners. The native copy
// pins the workspace's project directory and streams each owner through its
// own verified transfer.

export class WorkspaceProjectCopy {
  constructor(source,{withProject,withBook,onCopiedBook=async()=>{},onCopiedProject=async()=>{},check=async()=>{},checkpoint=async()=>{}}={}){this.source=source;this.withProject=withProject;this.withBook=withBook;this.onCopiedBook=onCopiedBook;this.onCopiedProject=onCopiedProject;this.check=check;this.checkpoint=checkpoint;this.native=new NativeWorkspaceProjectCopy(this);}
  plan(input,options={}){return this.native.plan(input,options);}
  exportPortable(input){return this.native.exportPortable(input);}
  encrypted(plan,access,vault,options={}) {
    return this.copy({...plan,encrypted:true},{...options,encryption:{access,vault},activateCatalogue:true});
  }
  copy(plan,options={}){return this.native.copy(plan,options);}
}
