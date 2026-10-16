import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook,validateNotebook} from '../src/model.js';
import {saveStructure} from '../src/structure.js';
import {starterTemplate,copyConfiguration,projectTypeChoices,projectTypeChoice,recommendedProfile,templateChoices,newLabBookConfiguration} from '../src/web/project-templates.js';
import {templateFrom} from '../src/web/notebook-schema.js';
import {buildPublication,publicProjection} from '../src/publication.js';
import {encryptedFixture} from './browser/encrypted-fixture.js';
import {clearVault} from '../src/encryption.js';
import {initializeLocation,copyPlan,copyWorkspace} from '../src/locations.js';
import {Workspace} from '../src/storage.js';

test('project templates copy into independent lab books without rewriting existing records',()=>{
 const original=sampleNotebook();original.formatVersion=20;const before=JSON.stringify(original),book=upgradeNotebook(original);
 assert.equal(book.formatVersion,21);assert.equal(JSON.stringify(original),before);
 const project=book.projects[0],template=starterTemplate('computer-it');project.labBookTemplate=template;
 const n=book.notebooks[0];n.configuration=copyConfiguration(template.configuration);const section=n.configuration.sections[0];book.entries[0].template=templateFrom(section);
 const frozen=structuredClone(book.entries),notebooks=structuredClone(book.notebooks);
 const updated=structuredClone(project);updated.labBookTemplate.configuration.sections[0].label='New build methodology';
 const saved=saveStructure(book,{kind:'project',value:updated}).book;
 assert.deepEqual(saved.entries,frozen);assert.deepEqual(saved.notebooks,notebooks);assert.notEqual(section.id,template.configuration.sections[0].id);
 const second=copyConfiguration(saved.projects[0].labBookTemplate.configuration);assert.equal(second.sections[0].label,'New build methodology');assert.notEqual(second.sections[0].id,section.id);
 assert.equal(section.label,'Environments & builds');
 for(const bad of [{name:'',configuration:template.configuration},{name:'x',configuration:{profiles:[],sections:[{}]}},{...template,unknown:true},null]){
  const invalid=structuredClone(saved);invalid.projects[0].labBookTemplate=bad;assert.throws(()=>validateNotebook(invalid),{code:'INVALID'});
 }
});

test('project-only templates stay private even when the project and its records are public',async()=>{
 const book=sampleNotebook();book.projects[0].labBookTemplate=starterTemplate('computer-it');book.projects[0].labBookTemplate.name='PRIVATE TEMPLATE SENTINEL';book.projects[0].labBookTemplate.configuration.sections[0].description='C:/Users/synthetic/private/build';
 validateNotebook(book);const projection=publicProjection(book);assert.ok(!JSON.stringify(projection).includes('PRIVATE TEMPLATE'));assert.ok(!JSON.stringify(projection).includes('C:/Users'));
 const {files}=buildPublication(book);for(const value of files.values())assert.ok(!Buffer.from(value).includes(Buffer.from('PRIVATE TEMPLATE')));
});

test('encrypted project templates survive restart, conflict rejection and portable backup',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-project-template-')),f=await encryptedFixture(directory,sampleNotebook());
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const initial=await f.workspace.read(),project={...initial.book.projects[0],kind:'Sound ecology wing',labBookTemplate:starterTemplate('arts-creative')};
 project.labBookTemplate.name='Private listening practice';
 const saved=await f.workspace.save(saveStructure(initial.book,{kind:'project',value:project}).book,initial.etag);
 await assert.rejects(f.workspace.save(initial.book,initial.etag),{code:'CONFLICT'});
 assert.deepEqual((await new Workspace(f.workspace.root,f.vault).read()).book.projects,saved.book.projects);
 const destination=path.join(directory,'backup');await copyWorkspace(await copyPlan(f.workspace.root,destination),{vault:f.vault});
 const restored=await new Workspace(destination,f.vault).read();assert.deepEqual(restored.book.projects,saved.book.projects);
 const other={...restored.book.projects[0],id:randomUUID(),title:'Other studio',labBookTemplate:{name:'Another template',configuration:copyConfiguration(project.labBookTemplate.configuration)}};
 const next=saveStructure(restored.book,{kind:'project',value:other}).book;next.projects.at(-1).labBookTemplate.configuration.sections[0].label='A different type';assert.notEqual(next.projects[0].labBookTemplate.configuration.sections[0].label,'A different type');
});

test('template choices and project defaults follow the enabled modules without modifying saved configurations',()=>{
 const enabled={enabledModules:['laboratory-computer-it']},disabled={enabledModules:[]},book=sampleNotebook();
 book.projects[0].labBookTemplate=starterTemplate('computer-it');const before=structuredClone(book.projects[0].labBookTemplate);
 assert.deepEqual(projectTypeChoices(disabled),[]);
 assert.deepEqual(projectTypeChoices(enabled),[{id:'profile:computer-it',label:'Computer / IT'}]);
 assert.equal(projectTypeChoice('Project',enabled),'none');assert.equal(projectTypeChoice(undefined,disabled),'none');
 for(const kind of ['Wing','Team','Collection','Department','Sound ecology'])assert.equal(projectTypeChoice(kind,enabled),'custom');
 assert.equal(projectTypeChoice('Computer / IT',enabled),'profile:computer-it');assert.equal(projectTypeChoice('Computer / IT',disabled),'custom');
 assert.equal(recommendedProfile('profile:computer-it',disabled),null);assert.equal(recommendedProfile('profile:computer-it',enabled).id,'computer-it');
 assert.equal(templateChoices(book,disabled).length,0);assert.equal(templateChoices(book,enabled).length,1);
 assert.deepEqual(newLabBookConfiguration(before,disabled),{profiles:[],sections:[]});assert.notDeepEqual(newLabBookConfiguration(before,enabled).sections,[]);
 assert.deepEqual(book.projects[0].labBookTemplate,before);
 book.projects[0].labBookTemplate={name:'Custom',configuration:{profiles:[],sections:[]}};assert.equal(templateChoices(book,disabled).length,1);
});

import {readAccess} from '../src/access.js';
import {readWorkspaceDashboard} from '../src/security/dashboard-storage.js';
import {defaultDashboard} from '../src/web/dashboard-model.js';
import {ResearchCatalogue} from '../src/research-catalogue.js';

test('initial template selections survive backup; failed settings writes never expose a partial workspace',async t=>{
 const directory=await mkdtemp(path.join(os.tmpdir(),'observanda-type-initialization-')),f=await encryptedFixture(directory,sampleNotebook());
 t.after(async()=>{clearVault(f.vault);await rm(directory,{recursive:true,force:true});});
 const access=(await readAccess(f.workspace.root)).value,dashboard=defaultDashboard(),destination=path.join(directory,'initialized');dashboard.enabledModules.push('laboratory-computer-it');
 await initializeLocation(destination,sampleNotebook(),access,f.vault,{dashboard});const workspace=new Workspace(destination,f.vault);assert.deepEqual((await readWorkspaceDashboard(workspace)).settings,dashboard);
 const backup=path.join(directory,'backup');await copyWorkspace(await copyPlan(destination,backup),{vault:f.vault});assert.deepEqual((await readWorkspaceDashboard(new Workspace(backup,f.vault))).settings,dashboard);
 const failed=path.join(directory,'failed'),original=ResearchCatalogue.prototype.encode;
 ResearchCatalogue.prototype.encode=function(table,id,value){if(this.workspace.root===failed&&table==='state'&&id==='workspace-settings:dashboard')throw Error('Synthetic settings failure');return original.call(this,table,id,value);};
 try{await assert.rejects(initializeLocation(failed,sampleNotebook(),access,f.vault,{dashboard}),/Synthetic settings failure/);}finally{ResearchCatalogue.prototype.encode=original;}
 await assert.rejects(new Workspace(failed,f.vault).read(),{code:'STORAGE_INCOMPLETE'});assert.deepEqual((await readWorkspaceDashboard(workspace)).settings,dashboard);
});
