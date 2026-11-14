// Requests of Preferences → Integrations for the workspace's server logins.
// A login is set up once and used by any website of the workspace. Its FTP
// password stays on this computer and is never returned.
import path from 'node:path';
import {AppError} from './errors.js';
import {ServerLogins,serverIdentity} from './server-logins.js';
import {SFTPTransport} from './sftp-transfer.js';
import {FTPTransport} from './ftp-transfer.js';
import {SSHHost} from './ssh-host.js';

export const SERVER_LOGIN_OPERATIONS=['list','save','remove','password','password-forget','check'];

async function listing(logins,credentials){
 const {logins:items,etag}=await logins.read(),persistent=!!credentials?.persistent();
 const rows=[];for(const login of items)rows.push({...login,...(login.protocol==='ftp'?{password:{saved:!!credentials&&await credentials.has(serverIdentity(login)),persistent}}:{})});
 return {logins:rows,etag,persistent};
}
// Signs in without changing anything on the server.
async function check(workspace,login,{credentials,ssh,ftp,sftp,signal}){
 // The tool check uses no folder; the configuration guard still needs a valid one.
 if(login.protocol==='ssh'){await ssh.check({host:login.host,port:login.port,user:login.user,identityFile:login.identityFile,directory:'/observanda-check'},{signal});return;}
 const c={host:login.host,port:login.port,user:login.user,directory:'/',...(login.protocol==='ftp'?{security:login.security}:{identityFile:login.identityFile})};
 const session=login.protocol==='ftp'?await ftp.open(c,{signal,password:await credentials?.read(serverIdentity(login))}):await (sftp??new SFTPTransport({staging:path.join(workspace.root,'.observanda','publishing-staging')})).open(c,{signal});
 await session.close();
}
export async function serverLoginRequest(operation,data,{workspace,hostCredentials:credentials,ssh=new SSHHost(),ftp=new FTPTransport(),sftp=null,signal}){
 if(!SERVER_LOGIN_OPERATIONS.includes(operation))throw new AppError('NOT_FOUND');
 const logins=new ServerLogins(workspace);
 if(operation==='save')await logins.save(data.login,data.etag);
 else if(operation==='remove')await logins.remove(data.id,data.etag);
 else if(operation==='password'||operation==='password-forget'){
  const login=await logins.get(data.id);if(login.protocol!=='ftp'||!credentials)throw new AppError('PUBLISH_CONFIG');
  if(operation==='password')await credentials.save(serverIdentity(login),data.password,{remember:data.remember!==false});else await credentials.forget(serverIdentity(login));
 }else if(operation==='check'){await check(workspace,await logins.get(data.id),{credentials,ssh,ftp,sftp,signal});return {...await listing(logins,credentials),checked:data.id};}
 return listing(logins,credentials);
}
