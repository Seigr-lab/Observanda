import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {prepareLanguage,activateLanguage,t} from '../src/web/i18n/index.js';
import {labBookProfileLabel,projectKindLabel,projectToolLabel} from '../src/web/project-type-presentation.js';
import {configurationProfileLabels} from '../src/web/configuration-profile-labels.js';
import {projectSettings} from '../src/web/project-settings.js';
import {projectNotebooksUI} from '../src/web/project-notebooks.js';
import {starterTemplate,projectTypeChoice} from '../src/web/project-templates.js';
import {emptyConfiguration} from '../src/web/notebook-schema.js';

const locales=['en','ca','es','nb','nn'];
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const load=locale=>prepareLanguage(locale,{fetcher:async url=>({ok:true,json:async()=>JSON.parse(await readFile(url,'utf8'))})});
const field=(label,control)=>'<label>'+esc(label)+control+'</label>';
const option=(value,label,selected)=>'<option value="'+esc(value)+'"'+(value===selected?' selected':'')+'>'+esc(label)+'</option>';
const settings={enabledModules:['laboratory-beekeeping']};
const projectId='00000000-0000-4000-8000-000000000001',bookId='00000000-0000-4000-8000-000000000002';
function fixture(context){
 const previousDocument=globalThis.document,previousFormData=globalThis.FormData;
 context.after(()=>{globalThis.document=previousDocument;globalThis.FormData=previousFormData;activateLanguage('en');});
 const project={id:projectId,title:'Project <authored> & 105₆',description:'Original',kind:'Beekeeping',tools:[],parentId:null};
 const book={id:bookId,projectId,title:'Book <authored> & 105₆',configuration:emptyConfiguration()};
 const state={book:{id:'00000000-0000-4000-8000-000000000003',title:'Workspace',projects:[project],notebooks:[book],entries:[]},storage:{contextId:'context'},dashboardSettings:settings};
 const elements={title:{value:project.title},description:{value:project.description},parentId:{value:''},customKind:{value:''},projectId:{value:projectId},publication:{checked:true}};
 const form={id:'structure-project-form',elements,querySelector:selector=>selector==='.project-config-scroll'?{scrollTop:0}:null,removeAttribute(){},reportValidity:()=>true};
 const dialog={querySelector:()=>({focus(){},scrollTop:0}),close(){}};
 globalThis.document={querySelector:selector=>selector==='#dialog'?dialog:form,activeElement:null};
 globalThis.FormData=class{constructor(){}getAll(){return [];}};
 let html='',saved;
 const services={state,esc,field,option,showDialog:value=>{html=value;},render(){},notify(){},rootBook:()=>state.book,
  projectDirectory:{entries:()=>[],navigation:()=>state.book},
  api:async(path,body)=>{if(path==='/api/projects/choices')return new Promise(()=>{});saved=body;return {book:state.book,etag:'next'};}
 };
 return {services,project,book,form,elements,html:()=>html,saved:()=>saved};
}

test('project and profile display labels translate without changing stored kinds or starter templates',async context=>{
 context.after(()=>activateLanguage('en'));
 const template=starterTemplate('beekeeping'),before=structuredClone(template),originalKind=template.name;
 for(const locale of locales){
  await load(locale);activateLanguage(locale);
  assert.equal(labBookProfileLabel('beekeeping'),t('labBookTypes','beekeeping.label'));
  assert.equal(labBookProfileLabel('clinical-medical'),t('labBookTypes','clinical-medical.label'));
  assert.equal(projectKindLabel('Biosafety & containment'),t('labBookTypes','biosafety-containment.label'));
  assert.equal(projectKindLabel(originalKind),t('labBookTypes','beekeeping.label'));
  assert.equal(projectKindLabel('Project'),t('projectEditors','project'));
  assert.equal(projectKindLabel('Authored <kind>'),'Authored <kind>');
  assert.equal(labBookProfileLabel('custom','Authored <profile>'),'Authored <profile>');
  assert.equal(projectToolLabel('resources'),t('projectEditors','inventoryTool'));
  assert.equal(projectTypeChoice(originalKind,settings),'profile:beekeeping');
  assert.deepEqual(template,before);
 }
});

test('project settings translate controls and persist the canonical selected project kind',async context=>{
 const f=fixture(context);
 for(const locale of locales){
  await load(locale);activateLanguage(locale);
  const ui=projectSettings(f.services);await ui.open(projectId);
  assert.ok(f.html().includes(esc(t('projectEditors','saveProject'))));
  assert.ok(f.html().includes(esc(t('labBookTypes','beekeeping.label'))));
  assert.ok(f.html().includes('value="'+esc(f.project.title)+'"'));
  assert.ok(!f.html().includes('<authored>'));
  await ui.submit(f.form);
  assert.equal(f.saved().change.value.kind,'Beekeeping');
  assert.equal(f.saved().change.value.title,f.project.title);
 }
});

test('lab-book cards use localized plurals and profile display without mutating authored data',async context=>{
 const f=fixture(context),configuration=f.book.configuration;
 configuration.profiles.push({id:'beekeeping',enabled:true},{id:'custom-profile',enabled:true});
 const before=structuredClone(f.services.state.book),labels=configurationProfileLabels(f.services),ui=projectNotebooksUI(f.services);
 for(const locale of locales){
  await load(locale);activateLanguage(locale);
  assert.deepEqual(labels.types(f.book),[t('labBookTypes','beekeeping.label'),'custom-profile']);
  for(const count of [0,1,2]){
   const html=ui.card({id:bookId,title:f.book.title,count,route:{action:'open-notebook',id:bookId},types:labels.types(f.book)});
   assert.ok(html.includes(esc(t('projectEditors','records',{count}))));
   assert.ok(html.includes(esc(t('projectEditors','openBook'))));
   assert.ok(html.includes(esc(f.book.title)));assert.ok(!html.includes('<authored>'));
  }
  assert.deepEqual(f.services.state.book,before);
 }
});

test('lab-book deletion review translates the count and escapes names before any destructive action',async context=>{
 const f=fixture(context);f.elements.title.value=f.book.title;
 f.services.state.book.entries=[{id:'record',notebookId:bookId}];
 const before=structuredClone(f.services.state.book),ui=projectNotebooksUI(f.services);
 for(const locale of locales){
  await load(locale);activateLanguage(locale);
  await ui.action({dataset:{action:'edit-notebook',id:bookId}});
  assert.ok(f.html().includes(esc(t('projectEditors','saveBook'))));
  await ui.action({dataset:{action:'lab-book-delete'}});
  assert.ok(f.html().includes(esc(t('projectEditors','containsRecords',{count:1}))));
  assert.ok(f.html().includes(esc(f.book.title)));assert.ok(!f.html().includes('<authored>'));
  assert.deepEqual(f.services.state.book,before);assert.equal(f.saved(),undefined);
 }
});
