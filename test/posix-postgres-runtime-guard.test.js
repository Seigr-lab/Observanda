import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rename,symlink,stat,realpath,rm,chmod,open} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import {fileURLToPath} from 'node:url';
import {acquirePosixPostgresRuntimeGuard} from '../src/posix-postgres-runtime-guard.js';

const linux=process.platform==='linux',launcher=fileURLToPath(new URL('../dist/native/linux-'+process.arch+'/postgres-confinement',import.meta.url));
function command(file,args,options={}){return new Promise((resolve,reject)=>{const child=spawn(file,args,{stdio:['ignore','pipe','pipe'],...options});let out='',err='';child.stdout?.on('data',x=>out+=x);child.stderr?.on('data',x=>err+=x);child.once('error',reject);child.once('close',code=>code===0?resolve(out.trim()):reject(Object.assign(Error(err||'Command failed'),{exitCode:code})));});}
const probe=`#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sched.h>
#include <sys/socket.h>
#include <sys/syscall.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>
static void write_value(const char *name){int fd=open(name,O_WRONLY|O_CREAT|O_TRUNC,0600);if(fd<0){perror("write");exit(2);}if(write(fd,"inside",6)!=6)exit(3);close(fd);}
int main(int argc,char **argv){
 if(argc>1&&!strcmp(argv[1],"gate")){puts("ready");fflush(stdout);char byte;if(read(0,&byte,1)!=1)return 4;write_value("/observanda/data/value");return 0;}
 if(argc>1&&!strcmp(argv[1],"descendant")){pid_t child=fork();if(child<0)return 5;if(child)return 0;setsid();puts("ready");fflush(stdout);int tries=0;while(access("/observanda/continue",F_OK)!=0){if(++tries>10000)return 6;usleep(1000);}write_value("/observanda/data/value");return 0;}
 if(argc>1&&!strcmp(argv[1],"symlink")){int fd=open("/observanda/data/value",O_WRONLY|O_TRUNC);if(fd>=0){close(fd);return 7;}return errno==ELOOP?0:8;}
 struct stat st;if(fstat(3,&st)==0)return 9;
 if(access("/proc/self/fd",F_OK)==0||access("/home",F_OK)==0)return 10;
 if(syscall(SYS_unshare,CLONE_NEWUSER)==0||errno!=EPERM)return 14;
 if(socket(AF_UNIX,SOCK_STREAM,0)>=0||errno!=EPERM)return 15;
 if(chmod("/runtime/bin/probe",0600)==0)return 11;
 int fd=open("/runtime/bin/probe",O_WRONLY|O_TRUNC);if(fd>=0){close(fd);return 12;}
 write_value("/observanda/data/value");write_value("/tmp/temporary");write_value("/dev/shm/shared");
 if(chmod("/observanda/data/value",0600)!=0)return 13;
 puts("confined");return 0;
}`;
async function fixture(t){
 const parent=await realpath(os.tmpdir()),root=await mkdtemp(path.join(parent,'observanda-confinement-test-'));await chmod(root,0o700);
 const closers=[];t.after(async()=>{for(const close of closers)await close();assert.equal(path.dirname(root),parent);assert.equal(await realpath(root),root);await rm(root,{recursive:true,force:true});});
 const directory=path.join(root,'database'),bin=path.join(root,'runtime','bin');await mkdir(path.join(directory,'data'),{recursive:true,mode:0o700});await chmod(directory,0o700);await mkdir(bin,{recursive:true});
 await writeFile(path.join(root,'probe.c'),probe);await command('/usr/bin/cc',['-O2','-Wall','-Wextra','-Werror',path.join(root,'probe.c'),'-o',path.join(bin,'probe')]);
 const value=await stat(directory,{bigint:true}),identity=value.dev+':'+value.ino;
 return {root,directory,bin,identity,cleanup:close=>closers.unshift(close)};
}
test('Linux runtime confines writes and closes inherited host descriptors',{skip:!linux},async t=>{
 const f=await fixture(t),outside=path.join(f.root,'outside');await writeFile(outside,'unchanged');const descriptor=await open(outside,'r+');f.cleanup(()=>descriptor.close());
 assert.equal(await command(launcher,[f.directory,f.identity,'--',path.join(f.bin,'probe')],{stdio:['ignore','pipe','pipe',descriptor.fd]}),'confined');
 assert.equal(await readFile(outside,'utf8'),'unchanged');assert.equal(await readFile(path.join(f.directory,'data','value'),'utf8'),'inside');
});
test('Linux launcher rejects inherited host files in standard descriptors',{skip:!linux},async t=>{
 const f=await fixture(t),outside=path.join(f.root,'outside');await writeFile(outside,'unchanged');const descriptor=await open(outside,'r+');f.cleanup(()=>descriptor.close());
 for(let index=0;index<3;index++){const stdio=['ignore','pipe','pipe'];stdio[index]=descriptor.fd;await assert.rejects(command(launcher,[f.directory,f.identity,'--',path.join(f.bin,'probe')],{stdio}),{exitCode:125});}
 assert.equal(await readFile(outside,'utf8'),'unchanged');
});
for(const mode of ['gate','descendant'])test('Linux '+mode+' keeps its admitted database after a root exchange',{skip:!linux},async t=>{
 const f=await fixture(t),outside=path.join(f.root,'outside');await mkdir(path.join(outside,'data'),{recursive:true});await writeFile(path.join(outside,'data','value'),'unchanged');
 const child=spawn(launcher,[f.directory,f.identity,'--',path.join(f.bin,'probe'),mode],{stdio:['pipe','pipe','pipe']});f.cleanup(()=>child.kill('SIGKILL'));const closed=once(child,'close');let errors='';child.stderr.on('data',x=>errors+=x);
 await new Promise((resolve,reject)=>{child.stdout.once('data',x=>String(x).includes('ready')?resolve():reject(Error('Unexpected readiness')));child.once('error',reject);child.once('close',code=>reject(Error('No readiness: '+code+' '+errors)));});
 const retained=path.join(f.root,'retained');await rename(f.directory,retained);await symlink(outside,f.directory,'dir');if(mode==='descendant')await writeFile(path.join(retained,'continue'),'x');else child.stdin.end('x');assert.equal((await closed)[0],0,errors);
 assert.equal(await readFile(path.join(retained,'data','value'),'utf8'),'inside');assert.equal(await readFile(path.join(outside,'data','value'),'utf8'),'unchanged');
});
test('Linux runtime rejects replaced roots and descendant symlinks',{skip:!linux},async t=>{
 const f=await fixture(t),outside=path.join(f.root,'outside');await mkdir(outside);await writeFile(path.join(outside,'value'),'unchanged');
 await rename(path.join(f.directory,'data'),path.join(f.directory,'retained'));await symlink(outside,path.join(f.directory,'data'),'dir');
 await command(launcher,[f.directory,f.identity,'--',path.join(f.bin,'probe'),'symlink']);assert.equal(await readFile(path.join(outside,'value'),'utf8'),'unchanged');
 await rename(f.directory,path.join(f.root,'original'));await mkdir(f.directory,{mode:0o700});await assert.rejects(command(launcher,[f.directory,f.identity,'--',path.join(f.bin,'probe')]),{exitCode:125});
});
test('Linux guard admits native identity and refuses use after close',{skip:!linux},async t=>{
 const f=await fixture(t),guard=await acquirePosixPostgresRuntimeGuard({directory:f.directory,expectedIdentity:f.identity,run:command});f.cleanup(()=>guard.close());
 assert.equal(guard.identity,f.identity);assert.equal(await guard.run(path.join(f.bin,'probe'),[]),'confined');await guard.close();await assert.rejects(guard.run(path.join(f.bin,'probe'),[]),{code:'DATABASE_GUARD_UNAVAILABLE'});
});
test('Linux guard preserves shutdown commands after startup cancellation',{skip:!linux},async t=>{
 const f=await fixture(t),controller=new AbortController(),guard=await acquirePosixPostgresRuntimeGuard({directory:f.directory,expectedIdentity:f.identity,run:command,signal:controller.signal});f.cleanup(()=>guard.close());
 controller.abort(Error('Cancelled startup'));await assert.rejects(guard.run(path.join(f.bin,'probe'),[],{signal:controller.signal}),/Cancelled startup/);
 assert.equal(await guard.run(path.join(f.bin,'probe'),[]),'confined');
});
test('Linux guard control-file members remain bound during root replacement',{skip:!linux},async t=>{
 const f=await fixture(t),guard=await acquirePosixPostgresRuntimeGuard({directory:f.directory,expectedIdentity:f.identity,run:command});f.cleanup(()=>guard.close());
 await writeFile(path.join(f.directory,'control'),'original');const retained=path.join(f.root,'retained');await rename(f.directory,retained);await mkdir(f.directory,{mode:0o700});await writeFile(path.join(f.directory,'control'),'substitute');
 assert.equal((await guard.member('control',(parent,name)=>parent.read(name,{limit:16}))).bytes.toString(),'original');await assert.rejects(guard.assertNamed(),{code:'DATABASE_GUARD_UNAVAILABLE'});
 await guard.member('control',async(parent,name)=>{const current=await parent.stat(name);await parent.remove(name,{identity:current.identity});});assert.equal(await readFile(path.join(f.directory,'control'),'utf8'),'substitute');
 await assert.rejects(guard.member('../escape',()=>assert.fail('Invalid member admitted')),{code:'UNSAFE'});
});
test('Linux guard rejects unavailable confinement before returning a runtime',{skip:!linux},async t=>{
 const f=await fixture(t);let probes=0;
 await assert.rejects(acquirePosixPostgresRuntimeGuard({directory:f.directory,expectedIdentity:f.identity,run:async(_file,args)=>{assert.equal(args.at(-1),'--probe');probes++;throw Object.assign(Error('Unavailable capability'),{exitCode:125});}}),{code:'DATABASE_GUARD_UNAVAILABLE'});
 assert.equal(probes,1);await assert.rejects(readFile(path.join(f.directory,'service.observanda')),{code:'ENOENT'});
});
test('macOS without a qualified process boundary fails closed',{skip:process.platform!=='darwin'},async()=>{
 await assert.rejects(acquirePosixPostgresRuntimeGuard({directory:'/unused',run:()=>assert.fail('Unconfined process launched')}),{code:'DATABASE_GUARD_UNAVAILABLE'});
});
test('Linux confined PostgreSQL initializes, queries, restarts and stops',{skip:!linux||!process.env.OBSERVANDA_TEST_POSTGRES_BIN,timeout:180000},async t=>{
 const f=await fixture(t),bin=process.env.OBSERVANDA_TEST_POSTGRES_BIN,guard=await acquirePosixPostgresRuntimeGuard({directory:f.directory,expectedIdentity:f.identity,run:command}),data=path.join(f.directory,'data');
 let started=false;f.cleanup(async()=>{if(started)await guard.run(path.join(bin,'pg_ctl'),['-D',data,'-m','immediate','-w','stop']);await guard.close();});
 assert.match(await guard.run(path.join(bin,'postgres'),['--version']),/PostgreSQL/);
 const password=path.join(f.directory,'bootstrap-password');await writeFile(password,'disposable-test-password\n',{mode:0o600});
 await guard.run(path.join(bin,'initdb'),['-D',data,'-U','observanda_admin','--pwfile='+password,'--auth-host=scram-sha-256','--auth-local=scram-sha-256','--encoding=UTF8','--no-locale','--data-checksums']);
 const reservation=net.createServer();await new Promise((resolve,reject)=>{reservation.once('error',reject);reservation.listen(0,'127.0.0.1',resolve);});const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
 const start=()=>guard.run(path.join(bin,'pg_ctl'),['-D',data,'-l',path.join(f.directory,'postgresql.log'),'-o','-h 127.0.0.1 -p '+port+' -c unix_socket_directories= -c shared_buffers=16MB -c max_connections=10','-w','-t','60','start']);
 await start();started=true;assert.match(await guard.run(path.join(bin,'pg_ctl'),['-D',data,'status']),/server is running/);
 const {Client}=await import('pg'),connect=async()=>{const client=new Client({host:'127.0.0.1',port,user:'observanda_admin',password:'disposable-test-password',database:'postgres'});await client.connect();return client;};
 let client=await connect();try{
  await client.query('CREATE TABLE confinement_check AS SELECT generate_series(1,5000) AS value');assert.equal((await client.query('SELECT count(*)::int AS count FROM confinement_check')).rows[0].count,5000);assert.equal((await client.query('SHOW data_directory')).rows[0].data_directory,'/observanda/data');
  await client.query('SET max_parallel_workers_per_gather=2; SET min_parallel_table_scan_size=0; SET parallel_setup_cost=0; SET parallel_tuple_cost=0');const plan=await client.query('EXPLAIN (ANALYZE,FORMAT JSON) SELECT sum(value) FROM confinement_check'),gather=plan.rows[0]['QUERY PLAN'][0].Plan.Plans.find(value=>value['Node Type']==='Gather');assert.ok(gather['Workers Launched']>0);
  const secret=path.join(f.root,'unrelated');await writeFile(secret,'outside');await assert.rejects(client.query('SELECT pg_read_file($1)',[secret]));
  const retained=path.join(f.root,'retained');await rename(f.directory,retained);await mkdir(f.directory,{mode:0o700});await writeFile(path.join(f.directory,'sentinel'),'unchanged');
  try{await client.query('INSERT INTO confinement_check VALUES (0)');await assert.rejects(guard.run(path.join(bin,'pg_ctl'),['-D',data,'status']),{code:'DATABASE_GUARD_UNAVAILABLE'});assert.equal(await readFile(path.join(f.directory,'sentinel'),'utf8'),'unchanged');}finally{await rename(f.directory,path.join(f.root,'substitution'));await rename(retained,f.directory);}
 }finally{await client.end();}
 await guard.run(path.join(bin,'pg_ctl'),['-D',data,'-m','fast','-w','stop']);started=false;
 await start();started=true;client=await connect();try{assert.equal((await client.query('SELECT sum(value)::int AS total FROM confinement_check')).rows[0].total,12502500);}finally{await client.end();}
 await guard.run(path.join(bin,'pg_ctl'),['-D',data,'-m','fast','-w','stop']);started=false;
});
