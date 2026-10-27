import {test} from 'node:test';
import assert from 'node:assert/strict';
import {figureEditor} from '../src/web/figure-editor-loader.js';
import {createFigure} from '../src/web/figure-model.js';

function fixture(load){
 let context='record-one',host={innerHTML:'',isConnected:true,setAttribute(){},removeAttribute(){}},changes=0;
 const figures=[],ui=figureEditor({getFigures:()=>figures,context:()=>context,busyChanged:()=>changes++},{load,root:()=>({querySelector:()=>host})});
 return {ui,figures,context:value=>context=value,host:()=>host,detach(){host.isConnected=false;host=null;},replace(){host={innerHTML:'',isConnected:true,setAttribute(){},removeAttribute(){}};},changes:()=>changes};
}

test('full-record figure controls load only for a form and still validate saves without UI',async()=>{
 let loads=0,validations=0,binds=0;
 const f=fixture(async()=>{loads++;return {figureEditor:()=>({view:()=>'<section>Figure controls</section>',bind:()=>binds++,validate:()=>validations++,isBusy:()=>false,release(){}})};});
 f.detach();await f.ui.bind();f.ui.validate();assert.equal(loads,0);
 const bad=createFigure();bad.title='';f.figures.push(bad);assert.throws(()=>f.ui.validate());assert.equal(loads,0);f.figures.length=0;
 f.replace();assert.match(f.ui.view(),/Opening figure editor/);assert.throws(()=>f.ui.validate());await f.ui.bind();assert.equal(loads,1);assert.equal(binds,1);assert.match(f.host().innerHTML,/Figure controls/);f.ui.validate();assert.equal(validations,1);
 f.ui.release();f.ui.view();await f.ui.bind();assert.equal(loads,1);assert.equal(binds,2);
});

for(const invalidation of ['owner','release','detached form'])test('delayed figure controls cannot populate a changed '+invalidation,async()=>{
 let resolve,created=0;
 const f=fixture(()=>new Promise(done=>{resolve=done;}));f.ui.view();const original=f.host(),request=f.ui.bind();await Promise.resolve();assert.equal(f.ui.isBusy(),true);
 if(invalidation==='owner')f.context('record-two');else if(invalidation==='release'){f.ui.release();f.ui.view();}else f.detach();
 resolve({figureEditor:()=>{created++;return {};}});await request;assert.equal(created,0);assert.ok(!original.innerHTML.includes('Figure controls'));assert.equal(f.ui.isBusy(),false);
});

test('failed figure downloads retain the form, refuse unchecked saves and permit retry',async()=>{
 let loads=0,resolve;
 const f=fixture(()=>{if(!loads++)throw Error('Offline');return new Promise(done=>{resolve=done;});});f.ui.view();await f.ui.bind();assert.match(f.host().innerHTML,/could not load/);assert.equal(f.ui.isBusy(),false);assert.throws(()=>f.ui.validate(),/could not load/);
 const retried=f.ui.action({dataset:{action:'record-figure-editor-retry'}});await Promise.resolve();await f.ui.bind();assert.equal(loads,2);assert.equal(f.ui.isBusy(),true);
 resolve({figureEditor:()=>({view:()=>'<section>Figure controls</section>',bind(){},validate(){},isBusy:()=>false})});assert.equal(await retried,true);assert.equal(f.ui.isBusy(),false);f.ui.validate();assert.match(f.host().innerHTML,/Figure controls/);
});
