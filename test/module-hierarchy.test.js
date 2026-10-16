import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createModuleHost,enabledModule,moduleChildren} from '../src/web/feature-modules.js';
import {laboratoryProfiles,laboratoryModuleId} from '../src/web/laboratory/catalog.js';
import {createDataRegistry} from '../src/web/data-registry.js';
test('parent state governs child loading while retained selections restore providers',async()=>{
 const registry=createDataRegistry(),loaded=[];
 const module=(id,parentId)=>({id,parentId,load:async()=>{loaded.push(id);return r=>r.register({id,label:id,items:()=>[]});}});
 const definitions=[module('suite'),module('domain','suite'),module('specialist','domain')];
 const host=createModuleHost(registry,definitions),selection=['domain','specialist'];
 await host.configure(selection);assert.deepEqual(loaded,[]);assert.equal(registry.all().length,0);
 selection.push('suite');await host.configure(selection);assert.equal(registry.all().length,3);
 assert.equal(enabledModule({enabledModules:selection},'specialist',definitions),true);
 await host.configure(['suite','specialist']);assert.deepEqual(registry.all().map(p=>p.id),['suite']);
 assert.equal(enabledModule({enabledModules:['suite','specialist']},'specialist',definitions),false);
 await host.configure(selection);assert.equal(registry.all().length,3);
 assert.deepEqual(selection,['domain','specialist','suite']);
});
test('lab-book types unload independently while workspace projects and lab books stay available',async()=>{
 const children=moduleChildren('research');assert.deepEqual(children.map(m=>m.id),laboratoryProfiles.map(p=>laboratoryModuleId(p.id)));
 const registry=createDataRegistry(),host=createModuleHost(registry);
 const a='laboratory-computer-it',b='laboratory-research-development';
 await host.configure([a,b]);
 assert.equal(registry.get('projects').moduleId,'projects');
 assert.equal(registry.get('records').moduleId,'research');
 assert.equal(registry.get(a+'-records').moduleId,a);
 assert.equal(registry.get(b+'-records').moduleId,b);
 await host.configure([b]);
 assert.equal(registry.get(a+'-records'),undefined);
 assert.equal(registry.get(b+'-records').moduleId,b);
 await host.configure([]);
 assert.equal(registry.get('projects').moduleId,'projects');
 assert.equal(registry.get('records').moduleId,'research');
 assert.equal(registry.get(a+'-records'),undefined);
 assert.equal(registry.get(b+'-records'),undefined);
 assert.equal(enabledModule({enabledModules:[]},'research'),true);
 assert.equal(enabledModule({enabledModules:[]},'projects'),true);
 assert.equal(enabledModule({enabledModules:[]},'laboratory'),false);
});


test('preferences separate templates from modules and sort each level without changing enabled choices',async()=>{
 const {modulePreferences,templatePreferences,sortedPreferenceModules}=await import('../src/web/module-preferences.js');
 const {prepareLanguage,activateLanguage,t}=await import('../src/web/i18n/index.js');
 const {readFile}=await import('node:fs/promises');
 const settings={enabledModules:['laboratory-beekeeping','planning']},before=structuredClone(settings),configured=[];
 const services={settings,esc:value=>String(value),error:()=>null,configuration:module=>{configured.push(module.id);return '';}};
 const modules=modulePreferences(services),templates=templatePreferences(services);
 assert.ok(!modules.includes('data-module-preference="research"'));
 assert.ok(!modules.includes('data-module-preference="laboratory-beekeeping"'));
 assert.ok(templates.includes('data-module-preference="laboratory-beekeeping"'));
 assert.ok(!templates.includes('data-module-preference="planning"'));
 assert.deepEqual([...modules.matchAll(/<strong>(.*?)<\/strong>/g)].map(m=>m[1]),[...modules.matchAll(/<strong>(.*?)<\/strong>/g)].map(m=>m[1]).sort((a,b)=>a.localeCompare(b,'en',{sensitivity:'base'})));
 assert.deepEqual(configured,['planning','laboratory-beekeeping']);assert.deepEqual(settings,before);
 assert.deepEqual(sortedPreferenceModules([{id:'z',label:'Zulu'},{id:'b',label:'beta'},{id:'a',label:'Alpha'}]).map(m=>m.id),['a','b','z']);
 await prepareLanguage('es',{fetcher:async url=>({ok:true,json:async()=>JSON.parse(await readFile(url,'utf8'))})});activateLanguage('es');
 try{
  const localized=templatePreferences(services),labels=[...localized.matchAll(/<strong>(.*?)<\/strong>/g)].map(m=>m[1]);
  assert.deepEqual(labels,[...labels].sort((a,b)=>a.localeCompare(b,'es',{sensitivity:'base'})));
  assert.ok(localized.includes(t('labBookTypes','beekeeping.label')));assert.deepEqual(settings,before);
 }finally{activateLanguage('en');}
});
