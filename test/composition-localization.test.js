import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as model from '../src/web/composition-tree.js';
import {elementName,elementGroup,moveElement} from '../src/web/composition-presentation.js';
import {bindReorder} from '../src/web/reorder-ui.js';
import {prepareLanguage,activateLanguage,t} from '../src/web/i18n/index.js';

const locales=['en','ca','es','nb','nn'];
async function language(locale){await prepareLanguage(locale,{fetcher:async url=>({ok:true,json:async()=>JSON.parse(await readFile(url,'utf8'))})});activateLanguage(locale);}

test('composition labels and movement errors translate without changing model defaults or authored elements',async context=>{
 context.after(()=>activateLanguage('en'));
 const definitions=structuredClone(model.ELEMENTS),elements=[{...model.newElement('container',()=>'container'),title:'Authored container'},{...model.newElement('text',()=>'text'),body:'Unchanged writing'}],original=structuredClone(elements);
 for(const locale of locales){
  await language(locale);
  for(const element of model.ELEMENTS){assert.equal(elementName(element),t('compositionControls','element_'+element.kind));assert.equal(elementGroup(element),t('compositionControls','group_'+element.group));}
  assert.equal(elementName({kind:'custom',name:'Authored extension'}),'Authored extension');
  assert.throws(()=>moveElement(elements,'container','container'),{message:t('compositionControls','insideSelf')});
  assert.throws(()=>model.moveElement(elements,'container','container'),{message:'An element cannot be placed inside itself.'});
  const moved=moveElement(elements,'text','container');assert.equal(moved.find(item=>item.id==='text').body,'Unchanged writing');
  assert.deepEqual(elements,original);assert.deepEqual(model.ELEMENTS,definitions);
  assert.equal(model.newElement('heading',()=>'heading').title,'Your heading');
 }
});

test('keyboard reorder announcements follow language changes on a mounted control and preserve commit behavior',async context=>{
 context.after(()=>activateLanguage('en'));
 const handlers=new Map(),rows=Array.from({length:3},()=>({classList:{toggle(){}}})),announcements=[],commits=[];
 const root={ownerDocument:{defaultView:{AbortController}},querySelectorAll:()=>rows,addEventListener:(name,handler)=>handlers.set(name,handler)};
 const handle={dataset:{reorderHandle:'authored-id'},closest:()=>rows[0]};
 const key=value=>handlers.get('keydown')({key:value,target:{closest:()=>handle},preventDefault(){},stopPropagation(){}});
 const dispose=bindReorder(root,{commit:(...args)=>commits.push(args),announce:value=>announcements.push(value)});
 for(const locale of locales){
  await language(locale);const count=commits.length;
  key(' ');assert.equal(announcements.at(-1),t('compositionControls','pickedUp',{label:t('compositionControls','panel')}));assert.equal(commits.length,count);
  key('ArrowDown');assert.equal(announcements.at(-1),t('compositionControls','position',{position:2,total:3}));
  key('Enter');assert.deepEqual(commits.at(-1),[0,1,'authored-id']);assert.equal(commits.length,count+1);
  assert.equal(announcements.at(-1),t('compositionControls','movedTo',{label:t('compositionControls','panel'),position:2}));
  key(' ');key('Escape');assert.equal(announcements.at(-1),t('compositionControls','cancelled'));assert.equal(commits.length,count+1);
 }
 dispose();
});
