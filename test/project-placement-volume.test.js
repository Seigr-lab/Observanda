import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {projectTreeFixture,destinationProject} from './project-tree-fixture.js';
import {ProjectRenames} from '../src/project-rename.js';
import {ProjectStorage} from '../src/project-storage.js';
import {LabBookStorage} from '../src/lab-book-storage.js';
import {LabBookRegistry} from '../src/lab-book-registry.js';
import {catalogueBinding} from '../src/postgres-activation.js';
import {workspaceRename,renameScope} from '../src/workspace-rename-state.js';
import {ResearchMaterials} from '../src/research-materials.js';

async function fixture(t){
 const f=await projectTreeFixture(t),target=await destinationProject(f,t),selected=f.projects[0],source=new ProjectStorage(selected.root,selected.projectId,selected.key),renames=new ProjectRenames(f.registry,selected.projectId);
 const callbacks={withProject:async(id,use)=>use(new ProjectStorage((await f.registry.locate(id)).root,id,f.projects.find(p=>p.projectId===id).key)),withBook:async(parent,id,use)=>use(new LabBookStorage((await new LabBookRegistry(parent).locate(id)).root,id,f.books.find(book=>book.labBookId===id).key))};
 const options={id:randomUUID(),name:path.basename(source.root),expectedName:path.basename(source.root),placement:{parentId:target.projectId,expectedParentId:null},...callbacks};
 return {...f,target,source,renames,options,destination:path.join(target.root,path.basename(source.root))};
}
async function differentFilesystem(f,operation){
 const original=fs.rename;let count=0;fs.rename=async(from,to)=>{if(from===f.source.root&&to===f.destination){count++;throw Object.assign(Error('Another filesystem'),{code:'EXDEV'});}return original(from,to);};syncBuiltinESMExports();
 try{return await operation(()=>count);}finally{fs.rename=original;syncBuiltinESMExports();}
}
async function checkTree(f){
 const result=await f.registry.locate(f.source.projectId);assert.equal(result.root,f.destination);assert.equal(result.parentId,f.target.projectId);
 await assert.rejects(fs.stat(f.source.root),{code:'ENOENT'});await assert.rejects(fs.stat(path.join(path.dirname(f.source.root),'.observanda-project-move-'+f.options.id)),{code:'ENOENT'});
 for(const saved of f.projects){
  const entry=await f.registry.locate(saved.projectId),root=path.join(f.destination,path.relative(f.source.root,saved.root));assert.equal(entry.root,root);assert.equal(entry.parentId,saved.projectId===f.source.projectId?f.target.projectId:saved.parentId);
  const binding=await catalogueBinding(root);assert.notEqual(binding.id,saved.binding.id);assert.equal(binding.projectId,saved.projectId);assert.equal(await workspaceRename(root),null);
  const storage=new ProjectStorage(root,saved.projectId,saved.key);assert.equal((await storage.outline()).metadata.title,path.basename(root));
  for(const book of f.books.filter(item=>item.projectId===saved.projectId)){const located=await new LabBookRegistry(storage).locate(book.labBookId);assert.equal(located.root,path.join(root,path.basename(book.root)));const copied=await catalogueBinding(located.root);assert.notEqual(copied.id,book.binding.id);assert.equal(copied.labBookId,book.labBookId);assert.deepEqual(await new LabBookStorage(located.root,book.labBookId,book.key).read(),book.before);assert.equal(await workspaceRename(located.root),null);}
 }
}

test('cross-filesystem project placement recovers each owner and retires the tree without repeating verified transfer',{timeout:360000},async t=>{
 const f=await fixture(t),container=new ProjectStorage(f.target.root,f.target.projectId,f.target.key);let transferred=false,created=false;
 const book=f.books[1],original=new LabBookStorage(book.root,book.labBookId,book.key),materials=new ResearchMaterials(original),bytes=Buffer.from('Original field observation bytes'),upload=await materials.startImport({recordId:book.before.book.entries[0].id,name:'observations.txt',size:bytes.length});await materials.appendImport(upload.id,0,[bytes]);const artifact=await materials.finishImport(upload.id);
 await differentFilesystem(f,async count=>{
  for(const boundary of ['copying','copy:file-receipt','copy:database-committed','copy:verified','owner-copied','transferred','metadata','registered','retiring','source-owner-stopped','retire-frozen','source-retired','retired','retire:removed','retire:marker-removed','source-removed','complete']){
   let interrupted=false;await assert.rejects(new ProjectRenames(f.registry,f.source.projectId).run(f.source,{...f.options,checkpoint:stage=>{
    if(transferred&&stage.startsWith('copy:'))assert.fail('Verified owner transfer repeated');
    if(stage===boundary&&!interrupted){interrupted=true;if(stage==='transferred')transferred=true;throw Error('Interrupted '+boundary);}
   }}),new RegExp('Interrupted '+boundary));assert.equal(interrupted,true);assert.equal(count(),1);
   if(boundary==='owner-copied'){
    await f.provider.closeProject(f.destination);await fs.rename(f.destination,f.destination+' saved');await fs.mkdir(f.destination);await fs.writeFile(path.join(f.destination,'keep'),'Independent replacement');
    await assert.rejects(f.renames.run(f.source,f.options),{code:'STORAGE_MOVE_STATE'});assert.equal(await fs.readFile(path.join(f.destination,'keep'),'utf8'),'Independent replacement');await fs.unlink(path.join(f.destination,'keep'));await fs.rmdir(f.destination);await fs.rename(f.destination+' saved',f.destination);
   }
   // A different owner can still save while this tree is frozen or retiring.
   if(!created){const item=await f.creation.create({id:randomUUID(),username:'',password:'',project:{id:randomUUID(),title:'Independent Sibling',description:'',parentId:f.target.projectId,share:false,logoId:null}});assert.equal(item.project.parentId,f.target.projectId);created=true;}
   await container.update(value=>{value.projects[0].description='Independent edit after '+boundary;return value;});
   process.stdout.write('Recovered project tree '+boundary+'\n');
  }
  assert.equal((await f.renames.run(f.source,f.options)).complete,true);assert.equal(count(),1);
 });
 await checkTree(f);const root=path.join(f.destination,path.relative(f.source.root,book.root)),moved=new LabBookStorage(root,book.labBookId,book.key),retained=new ResearchMaterials(moved);assert.deepEqual(await moved.readFile(await retained.artifactPath(await retained.read(artifact))),bytes);
 const unrelated=await f.creation.create({id:randomUUID(),username:'',password:'',project:{id:randomUUID(),title:'Independent Project',description:'',parentId:null,share:false,logoId:null}});assert.equal(unrelated.project.summary.title,'Independent Project');
});

test('project-tree recovery authenticates every retained owner before removing original databases',{timeout:240000},async t=>{
 const f=await fixture(t);await differentFilesystem(f,()=>assert.rejects(f.renames.run(f.source,{...f.options,checkpoint:stage=>{if(stage==='registered')throw Error('Before retirement');}}),/Before retirement/));
 const book=f.books[1],root=path.join(f.destination,path.relative(f.source.root,book.root)),storage=new LabBookStorage(root,book.labBookId,book.key),write=operation=>renameScope(f.options.id,()=>storage.withLock(()=>storage.catalogue(operation)));
 const row=await write(async store=>{const row=await store.db.get('SELECT id,revision,payload FROM records LIMIT 1');assert.ok(row);await store.db.run('UPDATE records SET payload=$1 WHERE id=$2 AND revision=$3',Buffer.alloc(row.payload.length),row.id,row.revision);return row;});
 await assert.rejects(f.renames.run(f.source,f.options),error=>['ENCRYPTION_DAMAGED','CATALOGUE_DAMAGED'].includes(error.code));assert.equal((await f.renames.read()).phase,'registered');for(const project of f.projects)assert.ok(await fs.stat(project.root));
 await write(store=>store.db.run('UPDATE records SET payload=$1 WHERE id=$2 AND revision=$3',row.payload,row.id,row.revision));assert.equal((await f.renames.run(f.source,f.options)).complete,true);await checkTree(f);
});

test('retiring a transferred project tree preserves a newly created folder at its old path',{timeout:240000},async t=>{
 const f=await fixture(t);await differentFilesystem(f,()=>assert.rejects(f.renames.run(f.source,{...f.options,checkpoint:stage=>{if(stage==='source-retired')throw Error('Retired source');}}),/Retired source/));
 await fs.mkdir(f.source.root);const sentinel=path.join(f.source.root,'new-user-file.txt');await fs.writeFile(sentinel,'Preserve this independent replacement');
 assert.equal((await f.renames.run(f.source,f.options)).complete,true);assert.equal(await fs.readFile(sentinel,'utf8'),'Preserve this independent replacement');assert.equal((await f.registry.locate(f.source.projectId)).root,f.destination);
});


test('a killed project-tree transfer resumes after source retirement using retained owner capabilities',{timeout:300000},async t=>{
 const f=await fixture(t);await f.stopProvider();const {spawn}=await import('node:child_process');let child,ended;
 const script=`import fs from 'node:fs/promises';import {syncBuiltinESMExports} from 'node:module';import path from 'node:path';import {WorkspaceDatabases} from './src/workspace-databases.js';import {installDatabaseProvider} from './src/workspace-database-context.js';import {Workspace} from './src/storage.js';import {ProjectStorage} from './src/project-storage.js';import {LabBookStorage} from './src/lab-book-storage.js';import {ProjectRegistry} from './src/project-registry.js';import {LabBookRegistry} from './src/lab-book-registry.js';import {ProjectRenames} from './src/project-rename.js';let raw='';for await(const chunk of process.stdin)raw+=chunk;const input=JSON.parse(raw),key=value=>({id:value.id,key:Buffer.from(value.key,'base64')}),provider=new WorkspaceDatabases(input.runtime);installDatabaseProvider(provider);const registry=new ProjectRegistry(new Workspace(input.root,key(input.vault)),input.workspaceId),selected=input.projects[0],source=new ProjectStorage(selected.root,selected.projectId,key(selected.key)),rename=fs.rename;fs.rename=async(from,to)=>{if(from===source.root&&to===input.destination)throw Object.assign(Error('Another filesystem'),{code:'EXDEV'});return rename(from,to);};syncBuiltinESMExports();await new ProjectRenames(registry,selected.projectId).run(source,{...input.options,withProject:async(id,use)=>use(new ProjectStorage((await registry.locate(id)).root,id,key(input.projects.find(p=>p.projectId===id).key))),withBook:async(parent,id,use)=>use(new LabBookStorage((await new LabBookRegistry(parent).locate(id)).root,id,key(input.books.find(b=>b.labBookId===id).key))),checkpoint:async stage=>{if(stage==='source-retired'){process.stdout.write('retired');await new Promise(()=>{});}}});`;
 try{
  child=spawn(process.execPath,['--input-type=module','-e',script],{cwd:process.cwd(),windowsHide:true,stdio:['pipe','pipe','pipe']});ended=new Promise(resolve=>child.once('exit',resolve));let errors='';child.stderr.on('data',bytes=>errors+=bytes);
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Tree retirement timeout: '+errors)),180000);child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',()=>{clearTimeout(timer);reject(Error('Tree move exited early: '+errors));});child.stdout.once('data',()=>{clearTimeout(timer);resolve();});const key=value=>({id:value.id,key:value.key.toString('base64')});child.stdin.end(JSON.stringify({runtime:f.runtime,root:f.root,workspaceId:f.registry.workspaceId,vault:key(f.workspace.vault),projects:f.projects.map(value=>({...value,key:key(value.key)})),books:f.books.map(value=>({...value,key:key(value.key)})),destination:f.destination,options:f.options}));});
 }finally{if(child&&child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await ended;}f.restartProvider();await f.workspace.outline();}
 const identity=await fs.stat(f.destination);assert.equal((await f.renames.resume(f.source.vault)).complete,true);assert.equal((await fs.stat(f.destination)).ino,identity.ino);await checkTree(f);
});
