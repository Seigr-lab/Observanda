import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp,rm,realpath} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import path from 'node:path';import os from 'node:os';import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {TestDeviceStore} from './device-fixture.js';
import {createWorkspaceAccess,takeCreatedVault} from '../src/access.js';
import {clearVault} from '../src/encryption.js';
import {WorkspaceDatabases} from '../src/workspace-databases.js';
import {installDatabaseProvider} from '../src/workspace-database-context.js';
import {initializeProjectLocation} from '../src/project-storage.js';
import {databaseCapacity} from '../src/postgres.js';
import {IdleConnections,idleConnections} from '../src/database-idle-connections.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';

class FakeClient extends EventEmitter{
 constructor(name){super();this.name=name;this.closed=0;this.refs=[];this.connection={stream:{ref:()=>this.refs.push('ref'),unref:()=>this.refs.push('unref')}};this.on('error',()=>{});}
}
const scope={host:'loopback',port:5432,user:'obo_a'};

test('the idle pool bounds connections per login and overall and evicts idle or lost ones',async()=>{
 const pool=new IdleConnections({perKey:2,limit:3,idleMs:40}),closed=[];
 const park=(key,client,value=scope)=>pool.park(key,client,value,async()=>{client.closed++;closed.push(client.name);});
 const [a1,a2,a3,b1,c1]=['a1','a2','a3','b1','c1'].map(name=>new FakeClient(name));
 assert.equal(park('a',a1),true);assert.equal(park('a',a2),true);
 assert.equal(park('a',a3),false,'a login keeps at most perKey idle connections');assert.equal(pool.size,2);
 assert.deepEqual(a1.refs,['unref'],'a parked socket never keeps the process alive');
 assert.equal(park('b',b1,{...scope,user:'obo_b'}),true);
 assert.equal(park('c',c1,{...scope,user:'obo_c'}),true,'the global limit evicts the oldest connection');
 await delay(0);assert.equal(pool.size,3);assert.deepEqual(closed,['a1']);
 assert.equal(pool.take('missing'),null);
 assert.equal(pool.take('b'),b1,'only the same key is reused');assert.deepEqual(b1.refs,['unref','ref']);
 assert.equal(pool.take('b'),null);
 c1.emit('end');await delay(0);assert.equal(pool.size,1,'a connection lost while idle leaves the pool');assert.deepEqual(closed,['a1','c1']);
 assert.equal(pool.take('a',()=>false),null,'an unusable connection is closed instead of reused');await delay(0);assert.deepEqual(closed,['a1','c1','a2']);
 const d1=new FakeClient('d1');park('d',d1);await delay(80);assert.equal(pool.size,0,'idle connections expire');assert.deepEqual(closed,['a1','c1','a2','d1']);
 const e1=new FakeClient('e1'),f1=new FakeClient('f1');park('e',e1,{...scope,user:'obo_e'});park('f',f1,{...scope,port:6000,user:'obo_e'});
 await pool.close(value=>value.port===5432);assert.equal(pool.size,1);assert.equal(e1.closed,1);assert.equal(f1.closed,0);
 await pool.close();assert.equal(pool.size,0);assert.equal(f1.closed,1);
 assert.equal(new IdleConnections({limit:0}).park('a',new FakeClient('z'),scope,()=>{}),false);
});

test('catalogue connections are reused within one owner role, reset before reuse and closed with their owner and cluster',{timeout:180000},async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-idle-connections-')),deviceStore=new TestDeviceStore({file:path.join(directory,'device.key')}),vaults=[],open=[];
 const owner=new WorkspaceDatabases({directory:path.join(directory,'runtime'),ownerId:randomUUID(),env:{...process.env,OBSERVANDA_POSTGRES_BIN:process.env.OBSERVANDA_TEST_POSTGRES_BIN}}),detach=installDatabaseProvider(owner);
 let workspace;
 t.after(async()=>{await Promise.allSettled(open.map(db=>db.close()));await owner.close();detach();for(const vault of vaults)await clearVault(vault);await clearVault(workspace?.vault);assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.ok(path.basename(directory).startsWith('observanda-idle-connections-'));await rm(directory,{recursive:true,force:true,maxRetries:10,retryDelay:100});});
 workspace=await encryptedFixture(path.join(directory,'workspace folder'),sampleNotebook());
 const projects=[];
 for(const name of ['a','b']){const book=sampleNotebook(),access=await createWorkspaceAccess('','',deviceStore),vault=takeCreatedVault(access);vaults.push(vault);book.title=book.projects[0].title=name;projects.push(await initializeProjectLocation(path.join(workspace.workspace.root,name),book.projects[0].id,book,access,vault));}
 const [a,b]=projects;
 const session=async storage=>{const db=await storage.openCatalogue();open.push(db);return db;};
 const done=async db=>{open.splice(open.indexOf(db),1);await db.close();};
 const identity=async db=>db.get('SELECT pg_catalog.pg_backend_pid() AS pid,current_user AS role');
 const port=async db=>Number((await db.get("SELECT pg_catalog.current_setting('port') AS port")).port);
 const parked=port=>idleConnections.entries.filter(entry=>entry.scope.port===port);

 // Reuse within one role.
 let db=await session(a);const first=await identity(db),cluster=await port(db),baseline=databaseCapacity();
 await done(db);assert.equal(databaseCapacity().active,baseline.active-1);assert.ok(parked(cluster).some(entry=>entry.scope.user===first.role));
 db=await session(a);assert.deepEqual(await identity(db),first,'the same role reuses its idle connection');

 // Session state never survives a reuse.
 const startup=await db.get("SELECT pg_catalog.current_setting('statement_timeout') AS timeout,pg_catalog.current_setting('application_name') AS name");
 // Session-level state is committed; a transaction is then left open.
 await db.run('CREATE TEMPORARY TABLE leaked_state(value integer)');
 await db.run("SELECT pg_catalog.pg_advisory_lock(pg_catalog.hashtextextended('Observanda/idle-connection-test',0))");
 await db.run("SET statement_timeout TO '7s'");await db.run("SET application_name TO 'leaked'");
 await db.run('BEGIN');await db.run('DECLARE leaked_cursor CURSOR WITH HOLD FOR SELECT 1');await db.run('COMMIT');
 await db.run('PREPARE leaked_statement AS SELECT 1');await db.run('LISTEN leaked_channel');
 await db.run('BEGIN');await db.run('INSERT INTO leaked_state VALUES (1)');
 await done(db);
 db=await session(a);assert.equal((await identity(db)).pid,first.pid,'the reset connection was reused');
 const state=await db.get(`SELECT pg_catalog.pg_current_xact_id_if_assigned() AS xact,
  (SELECT count(*) FROM pg_catalog.pg_class WHERE relpersistence='t' AND relnamespace=pg_catalog.pg_my_temp_schema())::int AS temporary,
  (SELECT count(*) FROM pg_catalog.pg_locks WHERE locktype='advisory' AND pid=pg_catalog.pg_backend_pid())::int AS advisory,
  (SELECT count(*) FROM pg_catalog.pg_cursors)::int AS cursors,(SELECT count(*) FROM pg_catalog.pg_prepared_statements)::int AS prepared,
  (SELECT count(*) FROM pg_catalog.pg_listening_channels())::int AS channels,
  pg_catalog.current_setting('statement_timeout') AS timeout,pg_catalog.current_setting('application_name') AS name`);
 assert.deepEqual(state,{xact:null,temporary:0,advisory:0,cursors:0,prepared:0,channels:0,timeout:startup.timeout,name:startup.name});

 // Another owner's role never receives that connection.
 const sibling=await session(b),other=await identity(sibling);
 assert.notEqual(other.role,first.role);assert.notEqual(other.pid,first.pid);
 await done(sibling);await done(db);
 const roleA=parked(cluster).filter(entry=>entry.scope.user===first.role).length,roleB=parked(cluster).filter(entry=>entry.scope.user===other.role).length;
 assert.equal(roleA,1);assert.equal(roleB,1);

 // Capacity: admission still bounds open connections; the idle pool stays bounded.
 const limit=databaseCapacity().limit,held=[];
 for(let i=0;i<limit;i++)held.push(await session(a));
 assert.equal(databaseCapacity().active,baseline.active-1+limit);
 const queued=a.openCatalogue();let admitted=false;queued.then(()=>{admitted=true;},()=>{});
 await delay(100);assert.equal(admitted,false,'a saturated role still queues while connections are idle elsewhere');assert.equal(databaseCapacity().queued,1);
 await done(held.pop());const late=await queued;open.push(late);held.push(late);
 for(const value of held.splice(0))await done(value);
 assert.ok(parked(cluster).filter(entry=>entry.scope.user===first.role).length<=idleConnections.perKey);assert.ok(idleConnections.size<=idleConnections.limit);
 assert.equal(databaseCapacity().active,baseline.active-1);

 // Closing an owner closes its parked connections before its credentials retire.
 const pids=async()=>{const observer=await session(b);try{return new Set((await observer.all('SELECT pid,usename FROM pg_catalog.pg_stat_activity WHERE usename=$1',first.role)).map(row=>row.pid));}finally{await done(observer);}};
 assert.ok((await pids()).size>0);
 await owner.closeProject(await realpath(a.root));
 assert.equal(parked(cluster).filter(entry=>entry.scope.user===first.role).length,0);
 for(let i=0;i<100&&(await pids()).size;i++)await delay(20);
 assert.equal((await pids()).size,0,'no connection of the closed owner remains on the server');

 // Closing the workspace closes every parked connection to its cluster before it stops.
 db=await workspace.workspace.openCatalogue();open.push(db);await done(db);
 assert.ok(parked(cluster).length>0);
 await owner.closeWorkspace(await realpath(workspace.workspace.root));
 assert.equal(parked(cluster).length,0);
});
