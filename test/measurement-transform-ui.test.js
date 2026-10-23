import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFragment} from 'parse5';
import {measurementTransformControls,readMeasurementTransform,wireMeasurementTransforms,measurementTransformDescription} from '../src/web/measurement-transform-ui.js';
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const field=(label,input)=>'<label>'+label+input+'</label>';
const q=(spelling,representation='decimal',radix=10)=>({spelling,representation,radix});
const transform=(origin='0',scale='1')=>({origin:q(origin),scale:q(scale)});

// Small DOM adapter over the rendered HTML. It retains element identity and
// event listeners so input-state changes are checked without a browser/DB run.
function dom(html){
 const document=parseFragment(html),cache=new WeakMap();
 const attrs=node=>Object.fromEntries((node.attrs??[]).map(a=>[a.name,a.value]));
 const children=node=>(node.childNodes??[]).flatMap(n=>[n,...children(n)]);
 const match=(node,selector)=>selector.split(',').some(s=>{const m=/^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(s);return m&&Object.hasOwn(attrs(node),m[1])&&(m[2]===undefined||attrs(node)[m[1]]===m[2]);});
 const wrap=node=>{
  if(cache.has(node))return cache.get(node);const a=attrs(node),listeners=new Map();
  const value={value:node.nodeName==='select'?(children(node).find(n=>n.nodeName==='option'&&Object.hasOwn(attrs(n),'selected'))??children(node).find(n=>n.nodeName==='option'))?.attrs.find(a=>a.name==='value')?.value??'':a.value??'',checked:Object.hasOwn(a,'checked'),disabled:Object.hasOwn(a,'disabled'),hidden:Object.hasOwn(a,'hidden'),
   querySelector:selector=>value.querySelectorAll(selector)[0]??null,
   querySelectorAll:selector=>children(node).filter(n=>match(n,selector)).map(wrap),
   addEventListener:(event,callback)=>listeners.set(event,[...(listeners.get(event)??[]),callback]),
   dispatch:event=>{for(const callback of listeners.get(event)??[])callback();}
  };cache.set(node,value);return value;
 };return wrap(document);
}
const axis=(root,name)=>root.querySelector('[data-projection-axis="'+name+'"]');
const item=(root,name)=>root.querySelector('[data-projection-'+name+']');
const quantity=(root,name)=>root.querySelector('[data-projection-quantity="'+name+'"]');
const render=(projection,options={})=>dom(measurementTransformControls(projection,{esc,field,...options}));

test('unchanged plots omit projection and nonnumeric x cannot enable a new transform',()=>{
 const root=render(undefined,{xKind:'category'});
 assert.equal(readMeasurementTransform(root,{xKind:'category'}),undefined);
 assert.equal(item(axis(root,'x'),'enabled').disabled,true);
 assert.equal(item(axis(root,'y'),'enabled').disabled,false);
 assert.equal(item(axis(root,'x'),'values').hidden,true);
 assert.equal(item(axis(root,'y'),'values').disabled,true);
});

test('controls preserve exact spelling and separate origin/scale numeral contexts',()=>{
 const projection={version:1,x:{origin:q('10.3','radix-fraction',6),scale:q('1/3','rational')},y:transform('1e1000','1e999')};
 const root=render(projection);assert.deepEqual(readMeasurementTransform(root),projection);
 const origin=quantity(axis(root,'x'),'origin');item(origin,'spelling').value='00010.30';
 assert.equal(readMeasurementTransform(root).x.origin.spelling,'00010.30');
 item(origin,'representation').value='decimal';assert.equal(readMeasurementTransform(root).x.origin.radix,10);
 item(origin,'representation').value='radix-fraction';assert.equal(readMeasurementTransform(root).x.origin.radix,6);
 const reopened=render(readMeasurementTransform(root));assert.deepEqual(readMeasurementTransform(reopened),readMeasurementTransform(root));
});

test('invalid edits survive a draft read but actual submission refuses rather than drops them',()=>{
 const root=render({version:1,x:transform()},{xKind:'date'});
 assert.equal(item(axis(root,'x'),'enabled').disabled,false);
 assert.equal(item(axis(root,'x'),'values').disabled,true);
 assert.throws(()=>readMeasurementTransform(root,{xKind:'date'}),/numeric horizontal/);
 assert.deepEqual(readMeasurementTransform(root,{xKind:'date',validate:false}),{version:1,x:transform()});
 const scale=quantity(axis(root,'x'),'scale');item(scale,'spelling').value='0';
 assert.throws(()=>readMeasurementTransform(root),/positive scales/);
 assert.equal(readMeasurementTransform(root,{validate:false}).x.scale.spelling,'0');
 item(scale,'spelling').value='1';item(scale,'representation').value='radix';item(scale,'radix').value='1';
 assert.throws(()=>readMeasurementTransform(root),/positive scales/);
 item(axis(root,'x'),'enabled').checked=false;assert.equal(readMeasurementTransform(root,{xKind:'date'}),undefined);
});

test('refresh changes availability in place without losing typed values or removable incompatible state',()=>{
 const root=render({version:1,x:transform()}),x=axis(root,'x'),origin=quantity(x,'origin'),input=item(origin,'spelling');let kind='number';
 const controls=wireMeasurementTransforms(root,{xKind:()=>kind});input.value='123456789012345678901234567890';
 kind='category';controls.refresh();assert.equal(item(x,'values').disabled,true);assert.equal(item(x,'enabled').disabled,false);assert.equal(item(origin,'spelling'),input);assert.equal(input.value,'123456789012345678901234567890');
 item(x,'enabled').checked=false;item(x,'enabled').dispatch('change');assert.equal(item(x,'values').hidden,true);assert.equal(item(x,'enabled').disabled,true);
 kind='number';controls.refresh();assert.equal(item(x,'enabled').disabled,false);item(x,'enabled').checked=true;item(x,'enabled').dispatch('change');
 const select=item(origin,'representation');select.value='radix';select.dispatch('change');assert.equal(item(origin,'base').hidden,false);assert.equal(input.value,'123456789012345678901234567890');
 select.value='decimal';select.dispatch('change');assert.equal(item(origin,'base').hidden,true);
});

test('rendered descriptions retain explicit bases and escape all display text',()=>{
 const projection={version:1,x:{origin:q('10.3','radix-fraction',6),scale:q('1/3','rational')}};
 const description=measurementTransformDescription(projection,{esc,numberText:()=>'<format>'});
 assert.match(description,/10\.3/);assert.match(description,/1\/3/);assert.match(description,/Numeral base \(2-36\): 6/);assert.match(description,/&lt;format&gt;/);assert.doesNotMatch(description,/<format>/);
 assert.equal(measurementTransformDescription({version:1,x:transform('0','0')},{esc}), '');
 const html=measurementTransformControls({version:1,x:transform('"<img src=x>','1')},{esc,field});
 assert.match(html,/&quot;&lt;img src=x&gt;/);assert.doesNotMatch(html,/<img/);
});
