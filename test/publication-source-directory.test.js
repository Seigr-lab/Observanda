import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {publicationSourceDirectory} from '../src/publication-source-directory.js';
import {ownerSourceHost} from '../src/owner-source-host.js';
import {ownerDirectorySortKey} from '../src/owner-directory-model.js';
import {AppError} from '../src/errors.js';
import {ProjectSessionOwner} from '../src/project-session-owner.js';
import {LabBookRegistry} from '../src/lab-book-registry.js';
import {LabBookDirectory} from '../src/lab-book-directory.js';
const fixture=()=>{
 const workspaceId=randomUUID(),projects=Array.from({length:125},(_,i)=>({projectId:randomUUID(),namespaceId:randomUUID(),parentId:null,summary:{title:'Project '+String(i).padStart(3,'0')}}));
 projects[1].parentId=projects[0].projectId;projects[3].summary.title=projects[2].summary.title;
 const state={revision:'first',pages:0,rows:0,streams:0,points:0},byId=new Map(projects.map(entry=>[entry.projectId,entry])),ordered=()=>projects.map(entry=>({key:ownerDirectorySortKey(entry.summary.title,entry.projectId),state:'active',entry})).sort((a,b)=>a.key<b.key?-1:1);
 const view=()=>({revision:state.revision,count:projects.length,
  async get(id){state.points++;const entry=byId.get(id);return entry?{state:'active',entry}:null;},
  async page({offset=0,limit}){state.pages++;const rows=ordered().slice(offset,offset+limit);state.rows+=rows.length;return {items:rows,total:projects.length,next:offset+rows.length<projects.length?rows.at(-1).key:null};},
  async *entries(){state.streams++;for(const row of ordered()){state.rows++;yield row;}},
  async ancestors(id){const chain=[],seen=new Set();while(id!==null){if(seen.has(id))throw new AppError('FORMAT');seen.add(id);const entry=byId.get(id);if(!entry)throw new AppError('NOT_FOUND');chain.push(entry);id=entry.parentId;}return chain;}
 });
 const registry={workspaceId,read(){throw Error('Discovery loaded the complete registry');},version:async()=>state.revision,inspect:async callback=>callback(view())},application={registry:async()=>registry,workspace:{root:'Project 062b',catalogue(){throw Error('Discovery opened record storage');}}};
 const command={workspaceId,projectId:null,search:'',offset:0,limit:25,revision:null};return {application,projects,command,state};
};
test('publication source discovery pages owner identities without opening record storage',async()=>{
 const f=fixture(),first=await publicationSourceDirectory(f.application,{},f.command),rows=[...first.items];
 assert.equal(first.total,125);assert.equal(first.items.length,25);assert.equal(f.state.rows,25);assert.equal(f.state.streams,0);assert.deepEqual(first.items.find(row=>row.projectId===f.projects[1].projectId).ancestors,['Project 000']);
 for(let offset=25;offset<125;offset+=25)rows.push(...(await publicationSourceDirectory(f.application,{}, {...f.command,offset,revision:first.revision})).items);
 assert.equal(f.state.rows,125);assert.equal(new Set(rows.map(row=>row.workspaceId)).size,125);assert.ok(rows.every(row=>!('root' in row)&&!('vaultId' in row)));
 const found=await publicationSourceDirectory(f.application,{}, {...f.command,search:'Project 002'});assert.equal(found.total,2);assert.notEqual(found.items[0].workspaceId,found.items[1].workspaceId);
 f.state.revision='second';await assert.rejects(publicationSourceDirectory(f.application,{}, {...f.command,offset:25,revision:first.revision}),{code:'CONFLICT'});
});
test('source discovery merges the optional host into indexed pages without loading a prefix',async()=>{
 const f=fixture(),rows=[];for(let offset=0;offset<126;offset+=7){const before=f.state.rows,page=await publicationSourceDirectory(f.application,{}, {...f.command,offset,limit:7},{includeHost:true});assert.ok(f.state.rows-before<=8);assert.equal(page.total,126);rows.push(...page.items);}
 assert.equal(rows.length,126);assert.equal(new Set(rows.map(row=>row.workspaceId)).size,126);assert.equal(rows[63].kind,'workspace');assert.equal(f.state.streams,0);
 const host=await ownerSourceHost(f.application,{workspaceId:f.projects[124].namespaceId,scope:f.projects[124].projectId});assert.deepEqual(host.directory,{revision:'first'});assert.equal('value' in host.directory,false);
});
test('source discovery validates the host, limits, cancellation and hierarchy',async()=>{
 const f=fixture();await assert.rejects(publicationSourceDirectory(f.application,{}, {...f.command,limit:51}),{code:'INVALID'});await assert.rejects(publicationSourceDirectory(f.application,{}, {...f.command,workspaceId:randomUUID()}),{code:'WORKSPACE_CHANGED'});
 const controller=new AbortController();controller.abort();await assert.rejects(publicationSourceDirectory(f.application,{},f.command,{signal:controller.signal}),{name:'AbortError'});
 f.projects[0].parentId=f.projects[1].projectId;await assert.rejects(publicationSourceDirectory(f.application,{},f.command),{code:'FORMAT'});
});

test('mixed content and excluded book windows retain equal cross-kind identities at every small offset and limit',async t=>{
 const workspaceId=randomUUID(),namespaceId=randomUUID(),books=['A','B','C','D'].map(directory=>({labBookId:randomUUID(),namespaceId:randomUUID(),directory})),projectId=books[1].labBookId,entry={projectId,namespaceId,parentId:null,summary:{title:'B'}},rows=books.map(entry=>({key:ownerDirectorySortKey(entry.directory,entry.labBookId),state:'active',entry}));
 const prior={use:ProjectSessionOwner.prototype.use,close:ProjectSessionOwner.prototype.close,inspect:LabBookRegistry.prototype.inspect,version:LabBookRegistry.prototype.version,locate:LabBookDirectory.prototype.locate,read:LabBookRegistry.prototype.read};let requested=0,read=0,streams=0;
 t.after(()=>{Object.assign(ProjectSessionOwner.prototype,{use:prior.use,close:prior.close});Object.assign(LabBookRegistry.prototype,{inspect:prior.inspect,version:prior.version,read:prior.read});LabBookDirectory.prototype.locate=prior.locate;});
 ProjectSessionOwner.prototype.use=async operation=>operation({root:process.cwd(),projectId});ProjectSessionOwner.prototype.close=async()=>{};
 LabBookDirectory.prototype.locate=async id=>{const book=books.find(value=>value.namespaceId===id);return book?{projectId,labBookId:book.labBookId}:null;};
 LabBookRegistry.prototype.read=()=>{throw Error('Window loaded the entire book directory');};LabBookRegistry.prototype.version=async()=>'books';
 LabBookRegistry.prototype.inspect=async operation=>operation({revision:'books',count:books.length,get:async id=>{const entry=books.find(book=>book.namespaceId===id);return entry?{state:'active',entry}:null;},page:async({offset,limit})=>{requested=limit;const items=rows.slice(offset,offset+limit);read+=items.length;return {items,total:rows.length};},async *entries(){streams++;yield*rows;}});
 const view={revision:'projects',get:async id=>id===projectId?{state:'active',entry}:null,ancestors:async()=>[entry]},registry={workspaceId,read(){throw Error('Window loaded all projects');},inspect:async operation=>operation(view),version:async()=>'projects'},application={registry:async()=>registry,session:()=>new Map(),workspace:{root:'Workspace'}};
 let windows=0;
 for(const label of ['0','A','B','C','Z'])for(const excluded of [null,...books]){
  entry.summary.title=label;const expected=[...books.filter(book=>book!==excluded).map(book=>({kind:'book',id:book.namespaceId,key:ownerDirectorySortKey(book.directory,book.labBookId)})),{kind:'content',id:namespaceId,key:ownerDirectorySortKey(label,projectId)+'\0'}].sort((a,b)=>a.key<b.key?-1:1),options=excluded?{scope:projectId,labBookId:excluded.labBookId}:{},base={workspaceId:excluded?.namespaceId??workspaceId,projectId,search:'',offset:0,limit:1,revision:null};
  for(let offset=0;offset<=expected.length+1;offset++)for(let limit=1;limit<=4;limit++){
   const before=read,page=await publicationSourceDirectory(application,{}, {...base,offset,limit},options);assert.deepEqual(page.items.map(row=>({kind:row.kind,id:row.workspaceId})),expected.slice(offset,offset+limit).map(({kind,id})=>({kind,id})),JSON.stringify({label,excluded:excluded?.directory,offset,limit}));assert.equal(page.total,expected.length);assert.ok(read-before<=limit+2);assert.ok(requested<=limit+2);windows++;
  }
  if(label==='B'&&excluded===books[1]){const page=await publicationSourceDirectory(application,{}, {...base,search:'B',limit:4},options);assert.equal(page.items.filter(row=>row.kind==='content').length,1);assert.equal(page.items.some(row=>row.workspaceId===excluded.namespaceId),false);}
 }
 assert.equal(streams,1);t.diagnostic(windows+' mixed windows, including equal project/book identity and label, without whole registry reads.');
});
