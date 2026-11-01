import path from 'node:path';
import {AppError} from './errors.js';
import {seal,unseal} from './encryption.js';
import {WindowsProtector} from './security/device-store.js';

export const runtimeUpgradeError=reason=>{const error=new AppError('DATABASE_GUARD_STORAGE');error.reason=reason;return error;};
export function runtimeStateProtector(workspace,purpose='state'){
 if(!workspace)return new WindowsProtector();
 const aad=purpose==='state'?'Observanda/workspace-postgresql/v1/'+workspace.vault.id:'Observanda/postgresql-upgrade/v1/'+workspace.vault.id;
 return {protect:bytes=>seal(bytes,workspace.vault.key,aad),unprotect:bytes=>unseal(bytes,workspace.vault.key,aad)};
}
export async function stoppedRuntimeConfiguration(bytes,workspace){
 const clear=await runtimeStateProtector(workspace).unprotect(bytes);let value;
 try{value=JSON.parse(clear.toString('utf8'));}finally{clear.fill(0);}
 if(value?.format!==1||value.phase!=='ready'||![16,17,18].includes(value.major)||!Number.isInteger(value.port)||value.port<1||value.port>65535||![value.adminPassword,value.appPassword].every(item=>typeof item==='string'&&/^[a-f0-9]{64}$/.test(item))||typeof value.bin!=='string'||!path.isAbsolute(value.bin)||workspace&&(value.workspaceId!==workspace.vault.id||value.running!==false||typeof value.ownerId!=='string'))throw runtimeUpgradeError('unauthenticated-or-running-source');
 return value;
}
const settings=new Set(['max_connections','shared_buffers','max_wal_size','min_wal_size','log_file_mode','dynamic_shared_memory_type','timezone','log_timezone','datestyle','lc_messages','lc_monetary','lc_numeric','lc_time','default_text_search_config','password_encryption','port','listen_addresses','unix_socket_directories']);
// Accept only the managed cluster's ordinary initdb settings. External files,
// libraries, commands and recovery configuration never enter the new runtime.
export function managedPostgresConfiguration(bytes){
 const lines=[];
 for(const raw of bytes.toString('utf8').split(/\r?\n/)){
  const line=raw.trim();if(!line||line.startsWith('#'))continue;
  const match=/^([a-z_]+)\s*=\s*('[^'\r\n\\]*'|[a-zA-Z0-9_+./,: -]+)\s*(?:#.*)?$/.exec(line);
  if(!match||!settings.has(match[1]))throw runtimeUpgradeError('unsupported-source-configuration');
  if(['listen_addresses','port','unix_socket_directories'].includes(match[1]))continue;
  lines.push(match[1]+' = '+match[2].trim());
 }
 return Buffer.from('# Managed PostgreSQL settings\n'+lines.join('\n')+'\n');
}
export function replacementRuntimeControl(relative,bytes){
 if(relative==='data/postgresql.conf'||relative==='data/postgresql.auto.conf')return managedPostgresConfiguration(bytes);
 if(relative==='data/pg_hba.conf')return Buffer.from('host all all 127.0.0.1/32 scram-sha-256\nhost all all ::1/128 scram-sha-256\n');
 if(relative==='data/pg_ident.conf')return Buffer.from('# Managed PostgreSQL identity mappings\n');
 return null;
}
export const runtimeConfigurationFiles=new Set(['data/postgresql.conf','data/postgresql.auto.conf','data/pg_hba.conf','data/pg_ident.conf']);
export function supportedRuntimeMember(relative,directory){
 if(relative==='.runtime-migration-proof'||relative.startsWith('.runtime-fence-')||relative.startsWith('.runtime-copy-pin-')||relative==='data/postmaster.pid'||relative==='data/recovery.signal'||relative==='data/standby.signal'||relative==='data/recovery.conf'||relative.startsWith('data/pg_tblspc/'))throw runtimeUpgradeError('unsupported-source-configuration');
 if(relative==='data/pg_tblspc'&&!directory)throw runtimeUpgradeError('unsupported-source-configuration');
}
