import {mkdtemp,mkdir,unlink,rmdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {AppError} from './errors.js';
import {writePublicFile,contentHash} from './file-content.js';
import {verifyPublicationCandidate} from './retained-publication-files.js';
import {publicationText} from './web/publication-messages.js';

export const shellQuote=value=>"'"+value.replaceAll("'","'\\''")+"'";
const batchQuote=value=>'"'+value.replaceAll('\\','\\\\').replaceAll('"','\\"')+'"';
const pointer=value=>value==='-'||/^releases\/[a-f0-9]{64}$/.test(value);

// The operation's symlink is an atomic remote claim. It is retained on any
// uncertain result and only its owner may resume or release it. A durable local
// checkpoint precedes every possible current-link switch.
export async function deploySSH(host,c,candidate,owner,{journal={},save=async()=>{},guard=async()=>{},progress=async()=>{},signal}={}){
 await verifyPublicationCandidate(candidate);if(!/^[a-f0-9-]{36}$/.test(owner))throw new AppError('PUBLISH_CONFIG');
 const checkpoint=async()=>{await guard();signal?.throwIfAborted();await save(structuredClone(journal));};
 const indexed=candidate.version===3;
 const report=key=>progress({stage:publicationText(key),done:journal.uploadedCount??journal.uploaded?.length??0,total:candidate.files.size});
 if(!journal.nonce){Object.assign(journal,{nonce:randomUUID(),...(indexed?{uploadedCount:0}:{uploaded:[]}),total:candidate.files.size,releaseId:candidate.id,lockAttempted:true});await checkpoint();}
 if(journal.releaseId!==candidate.id||(indexed?(!Number.isSafeInteger(journal.uploadedCount)||journal.uploadedCount<0||journal.uploadedCount>candidate.files.size):!Array.isArray(journal.uploaded))||!/^[a-f0-9-]{36}$/.test(journal.nonce))throw new AppError('JOB_DAMAGED');
 const root=c.directory,stage=root+'/.stage-'+journal.nonce,release=root+'/releases/'+candidate.id,lock=root+'/.publishing-lock',current=root+'/current',next=root+'/.current-'+journal.nonce,q=shellQuote;
 const call=async(script,input='')=>{await guard();signal?.throwIfAborted();return host.command(c,script,input,{signal});};
 const owned=`test -L ${q(lock)}; test "$(readlink ${q(lock)})" = ${q(journal.nonce)}; `;
 const readCurrent=`if test -L ${q(current)}; then readlink ${q(current)}; else test ! -e ${q(current)}; printf '%s\\n' '-'; fi`;
 const checksumRows=async function*(){for await(const [name,content] of candidate.files)yield contentHash(content)+'  '+name+'\n';};
 const checksums=()=>indexed?checksumRows():[...candidate.files].map(([name,content])=>contentHash(content)+'  '+name).join('\n')+'\n';
 const verify=directory=>`test -d ${q(directory)}; test ! -L ${q(directory)}; cd ${q(directory)}; test -z "$(find . ! -type f ! -type d -print)"; test "$(find . -type f | wc -l | tr -d ' ')" = ${candidate.files.size}; sha256sum -c - >/dev/null; find . -type f -exec chmod 644 {} +; find . -type d -exec chmod 755 {} +; `;
 await host.check(c,{signal});
 await report('sshClaim');
 // A lost acknowledgement here is recoverable with the already saved nonce.
 const initial=await call(`set -eu; umask 022; mkdir -p ${q(root)}; test "$(cd ${q(root)} && pwd -P)" = ${q(root)}; if test ! -e ${q(root+'/.observanda-owner')}; then test -z "$(ls -A ${q(root)})"; (set -C; printf '%s' ${q(owner)} > ${q(root+'/.observanda-owner')}); fi; test ! -L ${q(root+'/.observanda-owner')}; test "$(cat ${q(root+'/.observanda-owner')})" = ${q(owner)}; test ! -L ${q(root+'/releases')}; mkdir -p ${q(root+'/releases')}; if test ! -L ${q(lock)}; then ln -sT ${q(journal.nonce)} ${q(lock)}; fi; ${owned}${readCurrent}`);
 const remote=initial.trim();if(!pointer(remote))throw new AppError('PUBLISH_SSH');
 if(journal.parent===undefined){journal.parent=remote;await checkpoint();}
 if(!pointer(journal.parent)||remote!==journal.parent&&remote!=='releases/'+candidate.id)throw new AppError('PUBLISH_STALE');
 const exists=(await call(`set -eu; ${owned}if test -e ${q(release)} || test -L ${q(release)}; then printf sealed; elif test -d ${q(stage)} && test ! -L ${q(stage)}; then printf staged; else test ! -e ${q(stage)}; test ! -L ${q(stage)}; mkdir ${q(stage)}; printf new; fi`)).trim();
 if(!['sealed','staged','new'].includes(exists))throw new AppError('PUBLISH_SSH');
 if(exists==='new'){if(indexed)journal.uploadedCount=0;else journal.uploaded=[];await checkpoint();}
 if(exists!=='sealed'){
  const upload=async batch=>{
   const temp=await mkdtemp(path.join(os.tmpdir(),'observanda-publish-')),directories=new Set(),written=[];
   try{
    const commands=[];await report('sshUpload');
    for(const [name,content] of batch){
     let parent=path.posix.dirname(name);const ancestors=[];while(parent!=='.'){ancestors.unshift(parent);parent=path.posix.dirname(parent);}
     for(const ancestor of ancestors)if(!directories.has(ancestor)){directories.add(ancestor);await mkdir(path.join(temp,ancestor),{recursive:true});}
     const checks=ancestors.map(a=>`test ! -L ${q(stage+'/'+a)}; mkdir -p ${q(stage+'/'+a)}; `).join('');
     await call(`set -eu; ${owned}test -d ${q(stage)}; test ! -L ${q(stage)}; ${checks}test ! -L ${q(stage+'/'+name)};`);
     written.push(name);await writePublicFile(path.join(temp,name),content,{mode:0o600});commands.push('put '+batchQuote(name)+' '+batchQuote(stage+'/'+name));
    }
    await guard();signal?.throwIfAborted();await host.run('sftp',[...host.args(c),'-P',String(c.port),'-b','-',`${c.user}@${c.host}`],{cwd:temp,input:commands.join('\n')+'\n',signal});
    if(indexed)journal.uploadedCount+=batch.length;else journal.uploaded.push(...batch.map(([name])=>name));await checkpoint();
   }finally{
    // These bounded batch paths were created below this operation's mkdtemp.
    for(const name of written)await unlink(path.join(temp,name)).catch(()=>{});
    for(const directory of [...directories].sort((a,b)=>b.length-a.length))await rmdir(path.join(temp,directory)).catch(()=>{});
    await rmdir(temp).catch(()=>{});
   }
  };
  let batch=[],position=0;const completed=indexed?journal.uploadedCount:0;
  for await(const item of candidate.files){
   const skip=indexed?position++<completed:journal.uploaded.includes(item[0]);if(skip)continue;
   batch.push(item);if(batch.length===25){await upload(batch);batch=[];}
  }
  if(batch.length)await upload(batch);
  await report('sshVerify');await call(`set -eu; ${owned}${verify(stage)}`,checksums());
  await call(`set -eu; ${owned}test ! -e ${q(release)}; test ! -L ${q(release)}; mv -T ${q(stage)} ${q(release)};`);
 }
 await report('sshVerify');await call(`set -eu; ${owned}${verify(release)}`,checksums());
 if(indexed)journal.uploadedCount=candidate.files.size;else journal.uploaded=[...candidate.files.keys()];journal.commit=candidate.id;await checkpoint();
 if(!journal.receipt){
  journal.pushAttempted=true;await checkpoint();await report('sshSwitch');
  await call(`set -eu; ${owned}actual=$(${readCurrent}); test "$actual" = ${q(journal.parent)} || test "$actual" = ${q('releases/'+candidate.id)}; if test "$actual" != ${q('releases/'+candidate.id)}; then if test -L ${q(next)}; then test "$(readlink ${q(next)})" = ${q('releases/'+candidate.id)}; else test ! -e ${q(next)}; ln -sT ${q('releases/'+candidate.id)} ${q(next)}; fi; mv -Tf ${q(next)} ${q(current)}; fi; test "$(readlink ${q(current)})" = ${q('releases/'+candidate.id)};`);
  journal.receipt={releaseId:candidate.id,commit:candidate.id,previousRelease:journal.parent==='-'?null:journal.parent.slice(9),at:new Date().toISOString(),status:'uploaded-remote-verified',manifestHash:contentHash(await candidate.files.get('publication.json'))};await checkpoint();
 }
 // If unlocking succeeded but its response was lost, the next run can claim
// this same operation again, reconcile current and release the claim once more.
 await call(`set -eu; ${owned}test "$(readlink ${q(current)})" = ${q('releases/'+candidate.id)}; rm ${q(lock)};`);
 journal.released=true;await checkpoint();await report('sshConfirmed');return journal.receipt;
}
