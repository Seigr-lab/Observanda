import {mkdtemp,mkdir,unlink,rmdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {AppError} from './errors.js';
import {writePublicFile,contentHash} from './file-content.js';
import {verifyPublicationCandidate} from './retained-publication-files.js';
import {publicationText} from './web/publication-messages.js';
import {reviewedManifest,validLiveManifestBudget} from './publication-live-budget.js';

export const shellQuote=value=>"'"+value.replaceAll("'","'\\''")+"'";
const batchQuote=value=>'"'+value.replaceAll('\\','\\\\').replaceAll('"','\\"')+'"';
const pointer=value=>value==='-'||/^releases\/[a-f0-9]{64}$/.test(value);

// SSH and SFTP resolve paths independently. Starting at /, admit only parents
// whose entries cannot be replaced by another account. Check each parent
// before looking up or creating its child. find does not follow symlinks.
const trusted=String.raw`\( -uid 0 -o -uid "$publisher_uid" \) ! -perm -020 ! -perm -002`;
const pathGuards=String.raw`
publisher_uid=$(id -u)
safe_dir() { test "$(find "$1" -prune -type d ${trusted} -print)" = "$1"; }
ensure_dir() {
 if test ! -e "$1" && test ! -L "$1"; then mkdir -m 755 "$1"; fi
 safe_dir "$1"
}
safe_file() { test "$(find "$1" -prune -type f -links 1 ${trusted} -print)" = "$1"; }
safe_tree() {
 safe_dir "$1"
 unsafe=$(find "$1" ! \( ${trusted} \( -type d -o -type f -links 1 \) \) -print -quit)
 test -z "$unsafe"
}
`;
function checkRoot(directory,create){
 const components=directory.slice(1).split('/').map(shellQuote).join(' ');
 return `safe_dir /; prefix=''; for part in ${components}; do prefix="$prefix/$part"; ${create?'ensure_dir':'safe_dir'} "$prefix"; done; `;
}

// Reconcile an obsolete review without transmitting any old candidate bytes.
// A lost unlock may be retried; only the operation's own claim can be removed.
export async function settleSSHTransfer(host,c,owner,attempt,{signal,checksums}={}){
 const {journal,releaseId}=attempt;
 if(!/^[a-f0-9-]{36}$/.test(owner)||!/^[a-f0-9-]{36}$/.test(journal.nonce)||!/^[a-f0-9]{64}$/.test(releaseId)||journal.releaseId!==releaseId||journal.parent!==undefined&&!pointer(journal.parent))throw new AppError('JOB_DAMAGED');
 const root=c.directory,q=shellQuote,lock=q(root+'/.publishing-lock'),current=q(root+'/current'),marker=q(root+'/.observanda-owner');
 const components=root.slice(1).split('/').map(q).join(' '),expected=q('releases/'+releaseId);
 const inspect=`set -eu; ${pathGuards}
  safe_dir /; prefix=''; for part in ${components}; do prefix="$prefix/$part"; if test ! -e "$prefix" && test ! -L "$prefix"; then printf absent; exit 0; fi; safe_dir "$prefix"; done
  if test ! -e ${marker} && test ! -L ${marker}; then test -z "$(find ${q(root)} -mindepth 1 -maxdepth 1 -print -quit)"; printf absent; exit 0; fi
  safe_file ${marker}; test "$(cat ${marker})" = ${q(owner)}
  if test -L ${current}; then actual=$(readlink ${current}); else test ! -e ${current}; actual='-'; fi
  ${journal.parent===undefined?'':`test "$actual" = ${q(journal.parent)} || test "$actual" = ${expected};`}
  if test -L ${lock} || test -e ${lock}; then test -L ${lock}; test "$(readlink ${lock})" = ${q(journal.nonce)}; fi; `;
 const answer=await host.command(c,inspect+`printf '%s' "$actual"`,'',{signal});
 const remote=answer.trim();
 if(remote==='absent'){if(journal.pushAttempted)throw new AppError('PUBLISH_STALE');return false;}
 if(!pointer(remote))throw new AppError('PUBLISH_STALE');
 const active=!!journal.pushAttempted&&remote==='releases/'+releaseId;
 const count=attempt.fileInventory?.root?.count;
 if(active&&(!Number.isSafeInteger(count)||count!==attempt.manifest.manifestFiles+1||typeof checksums!=='function'))throw new AppError('JOB_DAMAGED');
 const release=q(root+'/releases/'+releaseId);
 const verify=active?`safe_dir ${q(root+'/releases')}; safe_tree ${release}; cd ${release}; test "$(find . -type f | wc -l | tr -d ' ')" = ${count}; sha256sum -c - >/dev/null; `:'';
 const completed=await host.command(c,inspect+`test "$actual" = ${q(remote)}; ${verify}if test -L ${lock}; then rm ${lock}; fi; printf settled`,active?checksums():'',{signal});
 if(completed.trim()!=='settled')throw new AppError('PUBLISH_STALE');
 return active;
}

// The operation's symlink is an atomic remote claim. It is retained on any
// uncertain result and only its owner may resume or release it. A durable local
// checkpoint precedes every possible current-link switch.
export async function deploySSH(host,c,candidate,owner,{journal={},save=async()=>{},guard=async()=>{},progress=async()=>{},signal,indexedFiles=false}={}){
 await verifyPublicationCandidate(candidate);if(!/^[a-f0-9-]{36}$/.test(owner))throw new AppError('PUBLISH_CONFIG');
 const checkpoint=async()=>{await guard(journal.receipt?{phase:'receipt'}:undefined);signal?.throwIfAborted();await save(structuredClone(journal));};
 const indexed=candidate.version===3||indexedFiles;
 const report=key=>progress({stage:publicationText(key),done:journal.uploadedCount??journal.uploaded?.length??0,total:candidate.files.size});
 if(!journal.nonce){Object.assign(journal,{nonce:randomUUID(),...(indexed?{uploadedCount:0}:{uploaded:[]}),total:candidate.files.size,releaseId:candidate.id,lockAttempted:true});await checkpoint();}
 if(journal.releaseId!==candidate.id||(indexed?(!Number.isSafeInteger(journal.uploadedCount)||journal.uploadedCount<0||journal.uploadedCount>candidate.files.size):!Array.isArray(journal.uploaded))||!/^[a-f0-9-]{36}$/.test(journal.nonce))throw new AppError('JOB_DAMAGED');
 const root=c.directory,stage=root+'/.stage-'+journal.nonce,release=root+'/releases/'+candidate.id,lock=root+'/.publishing-lock',current=root+'/current',next=root+'/.current-'+journal.nonce,q=shellQuote;
 const call=async(script,input='',phase)=>{await guard(phase?{phase}:undefined);signal?.throwIfAborted();return host.command(c,script,input,{signal});};
 const owned=`test -L ${q(lock)}; test "$(readlink ${q(lock)})" = ${q(journal.nonce)}; `;
 const marker=q(root+'/.observanda-owner'),releases=q(root+'/releases');
 const checkOwner=`safe_file ${marker}; test "$(cat ${marker})" = ${q(owner)}; `;
 const readCurrent=`if test -L ${q(current)}; then readlink ${q(current)}; else test ! -e ${q(current)}; printf '%s\\n' '-'; fi`;
 const checksumRows=async function*(){for await(const [name,content] of candidate.files)yield contentHash(content)+'  '+name+'\n';};
 const checksums=()=>indexed?checksumRows():[...candidate.files].map(([name,content])=>contentHash(content)+'  '+name).join('\n')+'\n';
 const verify=(directory,readOnly=false)=>`${pathGuards}safe_tree ${q(directory)}; cd ${q(directory)}; test "$(find . -type f | wc -l | tr -d ' ')" = ${candidate.files.size}; sha256sum -c - >/dev/null; `+(readOnly?'':'find . -type f -exec chmod 644 {} +; find . -type d -exec chmod 755 {} +; ');
 const receipt=async()=>({releaseId:candidate.id,commit:candidate.id,previousRelease:journal.parent==='-'?null:journal.parent.slice(9),at:new Date().toISOString(),status:'uploaded-remote-verified',...await reviewedManifest(candidate)});
 const releaseClaim=()=>call(`set -eu; test "$(readlink ${q(current)})" = ${q('releases/'+candidate.id)}; if test -e ${q(lock)} || test -L ${q(lock)}; then ${owned}rm ${q(lock)}; fi;`,'','reconcile');
 await guard({phase:'read'});await host.check(c,{signal});
 if(journal.pushAttempted){
  // Inspect the existing destination before claiming it or writing anything.
  // A lost switch response must remain recoverable after consent withdrawal.
  const observed=(await call(`set -eu; ${pathGuards}${checkRoot(root,false)}${checkOwner}safe_dir ${releases}; if test -e ${q(lock)} || test -L ${q(lock)}; then ${owned}:; fi; ${readCurrent}`,'','read')).trim();
  if(!pointer(journal.parent)||!pointer(observed)||observed!==journal.parent&&observed!=='releases/'+candidate.id)throw new AppError('PUBLISH_STALE');
  if(observed==='releases/'+candidate.id){
   await call(`set -eu; test "$(readlink ${q(current)})" = ${q('releases/'+candidate.id)}; ${verify(release,true)}`,checksums(),'read');
   journal.commit=candidate.id;journal.receipt??=await receipt();if(!validLiveManifestBudget(journal.receipt))Object.assign(journal.receipt,await reviewedManifest(candidate));await checkpoint();
   await releaseClaim();journal.released=true;await checkpoint();await report('sshConfirmed');return journal.receipt;
  }
  if(journal.receipt)throw new AppError('PUBLISH_STALE');
 }
 await report('sshClaim');
 // A lost acknowledgement here is recoverable with the already saved nonce.
 const initial=await call(`set -eu; umask 022; ${pathGuards}${checkRoot(root,true)}
  if test ! -e ${marker}; then
   test ! -L ${marker}
   entry=$(find ${q(root)} -mindepth 1 -maxdepth 1 -print -quit)
   test -z "$entry"
   (set -C; printf '%s' ${q(owner)} > ${marker})
  fi
  ${checkOwner}ensure_dir ${releases}
  if test ! -L ${q(lock)}; then ln -sT ${q(journal.nonce)} ${q(lock)}; fi
  ${owned}${readCurrent}`);
 const remote=initial.trim();if(!pointer(remote))throw new AppError('PUBLISH_SSH');
 if(journal.parent===undefined){journal.parent=remote;await checkpoint();}
 if(!pointer(journal.parent)||remote!==journal.parent&&remote!=='releases/'+candidate.id)throw new AppError('PUBLISH_STALE');
 const exists=(await call(`set -eu; ${pathGuards}${owned}
  if test -e ${q(release)} || test -L ${q(release)}; then
   printf sealed
  elif test -e ${q(stage)} || test -L ${q(stage)}; then
   safe_tree ${q(stage)}; printf staged
  else
   (umask 077; mkdir ${q(stage)}); safe_dir ${q(stage)}; printf new
  fi`)).trim();
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
     const checks=ancestors.map(a=>`ensure_dir ${q(stage+'/'+a)}; `).join('');
     const target=q(stage+'/'+name);
     await call(`set -eu; ${pathGuards}${owned}${checks}if test -e ${target} || test -L ${target}; then safe_file ${target}; fi;`);
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
  journal.receipt=await receipt();await checkpoint();
 }
 // A lost unlock response is reconciled without claiming or publishing again.
 // Only this operation's remaining claim may be released.
 await releaseClaim();
 journal.released=true;await checkpoint();await report('sshConfirmed');return journal.receipt;
}
