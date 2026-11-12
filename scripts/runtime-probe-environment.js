import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import {workDirectory} from './work-directory.js';

// GCM locates Git even for --version. Call only with the executable from an
// admitted runtime; never restore the user's PATH or Git configuration.
export function runtimeProbeWithGit(options,gitExecutable,{platform=process.platform}={}){
 return {...options,env:{...options.env,PATH:path.dirname(gitExecutable)+(platform==='win32'?';':':')+options.env.PATH}};
}

export function runtimeProbeEnvironment(directory,{platform=process.platform,environment=process.env}={}){
 const system=environment.SystemRoot??environment.SYSTEMROOT??'C:\\Windows',nullFile=platform==='win32'?'NUL':'/dev/null';
 return {
  PATH:platform==='win32'?path.win32.join(system,'System32'):'/usr/bin:/bin',LANG:'C',LC_ALL:'C',
  HOME:directory,USERPROFILE:directory,XDG_CONFIG_HOME:directory,APPDATA:directory,LOCALAPPDATA:directory,
  TMPDIR:directory,TEMP:directory,TMP:directory,
  ...(platform==='win32'?{SystemRoot:system,WINDIR:system}:{}),
  NODE_OPTIONS:'',ELECTRON_RUN_AS_NODE:'',JAVA_TOOL_OPTIONS:'',_JAVA_OPTIONS:'',JDK_JAVA_OPTIONS:'',
  GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:nullFile,GIT_CONFIG_SYSTEM:nullFile,GIT_TERMINAL_PROMPT:'0',
  DOTNET_CLI_HOME:directory,DOTNET_SKIP_FIRST_TIME_EXPERIENCE:'1',DOTNET_CLI_TELEMETRY_OPTOUT:'1'
 };
}
export async function withRuntimeProbeEnvironment(operation,options){
 const directory=await mkdtemp(path.join(await workDirectory(),'observanda-runtime-probe-'));
 try{return await operation({cwd:directory,env:runtimeProbeEnvironment(directory,options),windowsHide:true,timeout:30000,maxBuffer:65536});}
 finally{await rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
}
