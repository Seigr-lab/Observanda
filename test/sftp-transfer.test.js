import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {workDirectory} from '../scripts/work-directory.js';
import {SFTPTransport,sftpPath} from '../src/sftp-transfer.js';

// Runs sftp batch commands against an in-memory server, as OpenSSH's sftp
// does: a leading '-' ignores that command's failure, any other failure stops
// the batch with an error, and rename does not replace an existing file.
function server(){
 const files=new Map(),directories=new Set(['/']),batches=[];
 const args=line=>{const result=[];const pattern=/"((?:[^"\\]|\\.)*)"|(\S+)/g;let match;while((match=pattern.exec(line)))result.push(match[1]!==undefined?match[1].replace(/\\(.)/g,'$1'):match[2]);return result;};
 const parent=name=>name.slice(0,name.lastIndexOf('/'))||'/';
 const run=async(argv,{input})=>{
  assert.ok(argv.includes('-oBatchMode=yes')&&argv.includes('-oStrictHostKeyChecking=yes'),'keys and known hosts only');
  const lines=input.trim().split('\n');batches.push(lines);let output='';
  for(const line of lines){
   if(line==='quit')break;
   const ignore=line.startsWith('-'),[command,...rest]=args(ignore?line.slice(1):line);output+='sftp> '+line+'\n';
   const fail=()=>{if(!ignore)throw Object.assign(Error('sftp failed'),{code:'PUBLISH_SFTP'});};
   if(command==='mkdir'){if(directories.has(rest[0])||!directories.has(parent(rest[0])))fail();else directories.add(rest[0]);}
   else if(command==='cd'){if(!directories.has(rest[0]))fail();}
   else if(command==='put'){if(!directories.has(parent(rest[1])))fail();else files.set(rest[1],await readFile(rest[0]));}
   else if(command==='get'){if(!files.has(rest[0]))fail();else await writeFile(rest[1],files.get(rest[0]));}
   else if(command==='rename'){if(!files.has(rest[0])||files.has(rest[1]))fail();else{files.set(rest[1],files.get(rest[0]));files.delete(rest[0]);}}
   else if(command==='rm'){if(!files.has(rest[0]))fail();else files.delete(rest[0]);}
   else if(command==='rmdir'){if(!directories.has(rest[0]))fail();else directories.delete(rest[0]);}
   else if(command==='ls'){const directory=rest.at(-1);if(!directories.has(directory)){fail();continue;}
    for(const name of [...directories,...files.keys()])if(name!==directory&&parent(name)===directory)output+=(directories.has(name)?'drwxr-xr-x':'-rw-r--r--')+'    1 1000     1000     '+(files.get(name)?.length??4096)+' Nov 14 10:00 '+name+'\n';}
   else throw Error('unexpected command '+command);
  }
  return output;
 };
 return {files,directories,batches,run};
}

test('SFTP publishes through batches alone: folders, uploads, in-place replacement and listings with spaces',async t=>{
 const staging=await mkdtemp(path.join(await workDirectory('test-work'),'sftp-staging-'));t.after(()=>rm(staging,{recursive:true,force:true}));
 const s=server(),c={host:'example.org',port:22,user:'site',directory:'/home/site/public_html',identityFile:''};
 s.directories.add('/home');s.directories.add('/home/site');
 const session=await new SFTPTransport({run:s.run,staging}).open(c);
 assert.equal(await session.readText(c.directory+'/.observanda-owner',{missing:true}),null);
 await session.ensureDirectories([c.directory+'/.observanda-upload-x/media files']);
 assert.ok(s.directories.has('/home/site/public_html/.observanda-upload-x/media files'));
 await session.writeText(c.directory+'/.observanda-owner','owner');assert.equal(await session.readText(c.directory+'/.observanda-owner'),'owner');
 s.files.set(c.directory+'/index.html',Buffer.from('old'));
 await session.upload([{content:'new page',target:c.directory+'/.observanda-upload-x/index.html'},{content:Buffer.from('photo'),target:c.directory+'/.observanda-upload-x/media files/a "b".jpg'}]);
 await session.ensureDirectories([c.directory+'/media files']);
 await session.replace([{from:c.directory+'/.observanda-upload-x/index.html',to:c.directory+'/index.html'},{from:c.directory+'/.observanda-upload-x/media files/a "b".jpg',to:c.directory+'/media files/a "b".jpg'}]);
 assert.equal(s.files.get(c.directory+'/index.html').toString(),'new page');assert.equal(s.files.get(c.directory+'/media files/a "b".jpg').toString(),'photo');
 await session.replace([{from:c.directory+'/.observanda-upload-x/index.html',to:c.directory+'/index.html'}]);
 assert.equal(s.files.get(c.directory+'/index.html').toString(),'new page','a repeated move leaves the target in place');
 const listed=await session.list(c.directory);
 assert.deepEqual(listed.map(entry=>[entry.name,entry.directory]).sort(),[['.observanda-owner',false],['.observanda-upload-x',true],['index.html',false],['media files',true]]);
 await session.removeTree(c.directory+'/.observanda-upload-x');assert.equal(s.directories.has(c.directory+'/.observanda-upload-x'),false);
 await session.remove([c.directory+'/index.html',c.directory+'/gone.html']);assert.equal(s.files.has(c.directory+'/index.html'),false);
 await session.close();assert.deepEqual(await readdir(staging),[],'local copies are removed');
});

test('names that sftp would expand as wildcards and unsafe settings are refused',async t=>{
 const staging=await mkdtemp(path.join(await workDirectory('test-work'),'sftp-staging-'));t.after(()=>rm(staging,{recursive:true,force:true}));
 for(const name of ['/www/*.html','/www/a?.html','/www/[x].html','relative/path','/www/a\\b'])assert.equal(sftpPath(name),false,name);
 assert.equal(sftpPath('/www/a b/c.html'),true);
 const s=server(),c={host:'example.org',port:22,user:'site',directory:'/www',identityFile:''};s.directories.add('/www');
 const session=await new SFTPTransport({run:s.run,staging}).open(c);
 await assert.rejects(session.upload([{content:'x',target:'/www/[x].html'}]),{code:'PUBLISH_PATH'});
 await session.close();
 for(const bad of [{...c,host:'-oProxyCommand=x'},{...c,directory:'www'},{...c,identityFile:'key'},{...c,port:0}])await assert.rejects(new SFTPTransport({run:s.run,staging}).open(bad),{code:'PUBLISH_CONFIG'});
});
