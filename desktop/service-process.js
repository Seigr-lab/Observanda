import {spawn} from 'node:child_process';

// Use the separately shipped Node executable with an IPC pipe. Electron's
// RunAsNode capability is not needed, even when its fuse is disabled.
export function launchService(executable,service,environment){
 const env={...environment};delete env.NODE_OPTIONS;delete env.ELECTRON_RUN_AS_NODE;
 return spawn(executable,[service],{windowsHide:true,env,stdio:['pipe','pipe','pipe','ipc'],serialization:'json'});
}
