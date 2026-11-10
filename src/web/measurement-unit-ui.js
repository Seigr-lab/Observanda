import {scalarPolicyControls,readScalarPolicy,wireScalarPolicies,scalarPolicyDescription,scalarSpellingInput,readScalarSpelling,scalarSpellingView} from './measurement-scalar-ui.js';
import {t} from './i18n/index.js';
import {NUMBER_REPRESENTATIONS,numeralUsesRadix} from './numeral-context.js';
import {blankUnitDefinition,validUnitDefinition,convertUnitValue,sameUnitDimensions,UNIT_KINDS} from './measurement-unit-model.js';
import {catalogueUnits,catalogueUnit} from './measurement-unit-catalogue.js';
import {exactRational} from './measurement-rational.js';
const text=(key,args)=>t('measurements',key,args);
const get=(root,key)=>root.querySelector('[data-unit-'+key+']');
function editionLabel(value,ref){
 if(value?.source)return text('standardUnitEdition',{name:text('unitLabel-'+value.source.id),edition:value.source.revision});
 return ref?text('labUnitEdition',{revision:ref.revision}):'';
}
function dimensionRow(value,{esc,field}){return '<div data-unit-dimension class="material-fields">'+field(esc(text('dimensionAxis')),'<input data-unit-axis maxlength="100" spellcheck="false" value="'+esc(value.axis)+'">')+field(esc(text('dimensionExponent')),'<input data-unit-exponent type="number" min="-32" max="32" step="1" value="'+esc(value.exponent)+'">')+'<button type="button" class="button" data-unit-remove>'+esc(text('removeDimension'))+'</button></div>';}
export function measurementUnitControls(definition,{esc,field,kinds=UNIT_KINDS,path='quantity.unitDefinition',allowPolicy=true,unitSource=null,choices=true}){
 const value=definition??blankUnitDefinition(),scalar=key=>{const q=value[key];return '<fieldset data-unit-scalar="'+key+'"><legend>'+esc(text('unit'+key[0].toUpperCase()+key.slice(1)))+'</legend><div class="material-fields">'+field(esc(text('spelling')),scalarSpellingInput(q.spelling,{esc,field:path+'.'+key+'.spelling',attributes:'data-unit-spelling',resourcePolicy:value.resourcePolicy}))+field(esc(text('representation')),'<select data-unit-representation>'+NUMBER_REPRESENTATIONS.map(r=>'<option value="'+r+'"'+(r===q.representation?' selected':'')+'>'+esc(text(r==='radix'?'radixLabel':r))+'</option>').join('')+'</select>')+'<div data-unit-base'+(numeralUsesRadix(q.representation)?'':' hidden')+'>'+field(esc(text('radix')),'<input data-unit-radix type="number" min="2" max="36" value="'+esc(q.radix)+'">')+'</div></div></fieldset>';};
 const origin=editionLabel(value,unitSource);
 const choice=choices?'<p data-unit-edition'+(origin?'':' hidden')+'>'+esc(origin)+'</p><details data-unit-choices><summary>'+esc(text('unitLibraryChoose'))+'</summary><div data-unit-panel></div></details>':'';
 return '<div data-measurement-unit data-scalar-policy-owner="unit" data-unit-path="'+esc(path)+'" data-unit-policy="'+allowPolicy+'"'+(value.source?' data-unit-catalogue="'+esc(JSON.stringify(value.source))+'"':'')+(unitSource?' data-unit-library-ref="'+esc(JSON.stringify(unitSource))+'"':'')+'>'+choice+'<label><input data-unit-enabled type="checkbox"'+(definition?' checked':'')+'> '+esc(text('unitDeclare'))+'</label><fieldset data-unit-values'+(definition?'':' hidden disabled')+'>'+field(esc(text('unitKind')),'<select data-unit-kind>'+kinds.map(kind=>'<option value="'+kind+'"'+(kind===value.kind?' selected':'')+'>'+esc(text('unit-'+kind))+'</option>').join('')+'</select>')+'<p>'+esc(text('unitHelp'))+'</p><div data-unit-dimensions>'+value.dimensions.map(d=>dimensionRow(d,{esc,field})).join('')+'</div><button type="button" class="button" data-unit-add'+(value.dimensions.length>=16?' disabled':'')+'>'+esc(text('addDimension'))+'</button>'+'<small>'+esc(text('unitLimits'))+'</small>'+scalar('scale')+scalar('offset')+scalarPolicyControls(value.resourcePolicy,{esc,field,kind:'unit',allowed:allowPolicy})+'<p>'+esc(text('unitFormula'))+'</p></fieldset></div>';
}
export function readMeasurementUnit(root,{validate=false}={}){
 const node=root.matches?.('[data-measurement-unit]')?root:root.querySelector('[data-measurement-unit]');if(!node||!get(node,'enabled').checked)return undefined;
 const dimensions=[...node.querySelectorAll('[data-unit-dimension]')].map(row=>({axis:get(row,'axis').value,exponent:get(row,'exponent').value===''?'':Number(get(row,'exponent').value)})).sort((a,b)=>a.axis<b.axis?-1:a.axis>b.axis?1:0);
 const scalars=Object.fromEntries(['scale','offset'].map(key=>{const q=node.querySelector('[data-unit-scalar="'+key+'"]'),representation=get(q,'representation').value;return [key,{spelling:readScalarSpelling(get(q,'spelling'),{validate}),representation,radix:numeralUsesRadix(representation)?Number(get(q,'radix').value):10}];}));
 const resourcePolicy=readScalarPolicy(node,'unit',{validate}),source=node.dataset.unitCatalogue&&JSON.parse(node.dataset.unitCatalogue);
 const value={version:resourcePolicy?2:1,kind:get(node,'kind').value,dimensions,...scalars,...(resourcePolicy?{resourcePolicy}:{}),...(source?{source}:{})};if(validate&&!validUnitDefinition(value))throw RangeError(text('unitInvalid'));return value;
}
export function wireMeasurementUnits(root,{esc,field,call,recordId,guard=()=>{}}){
 const policyDispose=wireScalarPolicies(root,'unit'),controller=new AbortController(),refresh=node=>{const enabled=get(node,'enabled').checked,values=get(node,'values');values.hidden=!enabled;values.disabled=!enabled;get(node,'add').disabled=node.querySelectorAll('[data-unit-dimension]').length>=16;for(const q of node.querySelectorAll('[data-unit-scalar]'))get(q,'base').hidden=!numeralUsesRadix(get(q,'representation').value);};
 const options={signal:controller.signal,capture:true},kinds=node=>Array.from(get(node,'kind').options,option=>option.value);
 function apply(node,unit,ref){
  const path=node.dataset.unitPath,template=node.ownerDocument.createElement('template');
  template.innerHTML=measurementUnitControls(unit.definition,{esc,field,kinds:kinds(node),path,allowPolicy:node.dataset.unitPolicy==='true',unitSource:ref});
  const target=template.content.firstElementChild;node.replaceWith(target);
  const symbol=path==='quantity.unitDefinition'?target.closest('[data-material-column],form')?.querySelector('[data-schema="unit"],[data-measurement="unit"]'):path.endsWith('.rate.unitDefinition')?target.closest('[data-clock-rate-values]')?.querySelector('[data-clock-unit]'):null;
  if(symbol){symbol.value=unit.symbol;symbol.dispatchEvent(new Event('input',{bubbles:true}));}
  refresh(target);target.querySelector('summary').focus();target.dispatchEvent(new Event('input',{bubbles:true}));return target;
 }
 root.addEventListener('toggle',event=>{
  const details=event.target;if(!details.matches?.('[data-unit-choices]')||!details.open)return;
  const node=details.closest('[data-measurement-unit]'),panel=get(node,'panel');
  if(panel.childElementCount)return;
  const choices=catalogueUnits({kinds:kinds(node)});
  panel.innerHTML=field(esc(text('unitLibraryStandard')),'<select data-unit-standard><option value="">'+esc(text('unitLibraryChoose'))+'</option>'+choices.map(item=>'<option value="'+item.id+'">'+esc(item.symbol+' · '+text('unitLabel-'+item.id))+'</option>').join('')+'</select>')+
   '<div data-unit-standard-actions hidden><p data-unit-compatibility role="status"></p><button type="button" class="button" data-unit-apply-standard>'+esc(text('unitLibraryUse'))+'</button>'+
   '<details data-unit-trial><summary>'+esc(text('unitLibraryTry'))+'</summary>'+field(esc(text('spelling')),'<input data-unit-trial-value value="1" spellcheck="false" maxlength="8192">')+
   field(esc(text('representation')),'<select data-unit-trial-representation>'+NUMBER_REPRESENTATIONS.map(rep=>'<option value="'+rep+'"'+(rep==='decimal'?' selected':'')+'>'+esc(text(rep==='radix'?'radixLabel':rep))+'</option>').join('')+'</select>')+
   field(esc(text('radix')),'<input data-unit-trial-radix type="number" min="2" max="36" value="10">')+
   '<button type="button" class="button" data-unit-convert>'+esc(text('unitLibraryConvert'))+'</button><output data-unit-converted aria-live="polite"></output></details></div><p>'+esc(text('unitLibraryTemperature'))+'</p>';
  if(call&&recordId&&node.dataset.unitPath==='quantity.unitDefinition'){
   void import('./measurement-unit-library-ui.js').then(({wireUnitLibrary})=>{
    if(controller.signal.aborted||!node.isConnected)return;
    wireUnitLibrary({node,panel,esc,field,call,recordId,guard,signal:controller.signal,apply,read:()=>readMeasurementUnit(node,{validate:true})});
   }).catch(error=>{if(node.isConnected)panel.append(error.message);});
  }
 },options);
 root.addEventListener('change',event=>{
  const select=event.target;if(!select.matches?.('[data-unit-standard]'))return;
  const node=select.closest('[data-measurement-unit]'),unit=catalogueUnit(select.value);
  get(node,'standard-actions').hidden=!unit;if(!unit)return;
  let current;try{current=readMeasurementUnit(node,{validate:true});}catch{}
  const compatible=!!current&&current.kind===unit.definition.kind&&sameUnitDimensions(current,unit.definition);
  get(node,'compatibility').textContent=current?text(compatible?'unitLibraryCompatible':'unitLibraryDimensionChange'):'';
  get(node,'trial').hidden=!compatible;get(node,'converted').textContent='';
 },options);
 root.addEventListener('click',event=>{
  const control=event.target.closest?.('[data-unit-apply-standard],[data-unit-convert]');if(!control)return;
  const node=control.closest('[data-measurement-unit]'),unit=catalogueUnit(get(node,'standard').value);
  if(!unit)return;
  if(control.hasAttribute('data-unit-apply-standard')){apply(node,unit,null);return;}
  const result=get(node,'converted'),representation=get(node,'trial-representation').value;
  try{
   const current=readMeasurementUnit(node,{validate:true}),spelling=get(node,'trial-value').value;
   const value=exactRational(spelling,representation,numeralUsesRadix(representation)?Number(get(node,'trial-radix').value):10);
   const {numerator,denominator}=convertUnitValue(value,current,unit.definition);
   result.textContent=text('unitLibraryConverted',{value:denominator===1n?String(numerator):numerator+'/'+denominator,unit:unit.symbol});
  }catch{result.textContent=text('unitLibraryTrialInvalid');}
 },options);
 root.addEventListener('input',event=>{
  const node=event.target.closest?.('[data-measurement-unit]');
  if(node&&event.target!==node&&!event.target.closest('[data-unit-choices]')&&!event.target.matches('[data-unit-enabled]')){
   delete node.dataset.unitCatalogue;delete node.dataset.unitLibraryRef;
   const edition=get(node,'edition');if(edition){edition.hidden=true;edition.textContent='';}
  }
 },options);
 root.addEventListener('change',event=>{const node=event.target.closest('[data-measurement-unit]');if(node)refresh(node);},{signal:controller.signal});
 root.addEventListener('click',event=>{const add=event.target.closest('[data-unit-add]'),remove=event.target.closest('[data-unit-remove]');if(!add&&!remove)return;const node=event.target.closest('[data-measurement-unit]');if(add&&node.querySelectorAll('[data-unit-dimension]').length<16)get(node,'dimensions').insertAdjacentHTML('beforeend',dimensionRow({axis:'',exponent:1},{esc,field}));if(remove)remove.closest('[data-unit-dimension]').remove();refresh(node);get(node,'dimensions').dispatchEvent(new Event('input',{bubbles:true}));},{signal:controller.signal});
 for(const node of root.querySelectorAll('[data-measurement-unit]'))refresh(node);return ()=>{controller.abort();policyDispose();};
}
export function measurementUnitDescription(definition,{esc,path='quantity.unitDefinition',unitSource}){
 if(!validUnitDefinition(definition))return '';
 const scalar=key=>{const q=definition[key];return scalarSpellingView(q.spelling,{esc,field:path+'.'+key+'.spelling'})+' ('+esc(text(q.representation==='radix'?'radixLabel':q.representation))+(numeralUsesRadix(q.representation)?', '+esc(text('radix'))+' '+q.radix:'')+')';};
 const edition=editionLabel(definition,unitSource);
 return '<div data-retained-unit><strong>'+esc(text('unitDeclared'))+'</strong>'+(edition?'<p>'+esc(edition)+'</p>':'')+'<dl><dt>'+esc(text('unitKind'))+'</dt><dd>'+esc(text('unit-'+definition.kind))+'</dd><dt>'+esc(text('dimensions'))+'</dt><dd>'+esc(definition.dimensions.map(d=>d.axis+'^'+d.exponent).join(' * ')||text('dimensionless'))+'</dd><dt>'+esc(text('unitScale'))+'</dt><dd>'+scalar('scale')+'</dd><dt>'+esc(text('unitOffset'))+'</dt><dd>'+scalar('offset')+'</dd></dl>'+scalarPolicyDescription(definition.resourcePolicy,{esc})+'</div>';
}
