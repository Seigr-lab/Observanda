import messages from './locales/en/measurementTransform.json' with {type:'json'};
import numberMessages from './locales/en/measurementOutput.json' with {type:'json'};
import {NUMBER_REPRESENTATIONS,numeralUsesRadix} from './numeral-context.js';
import {validMeasurementProjection,validateMeasurementProjection} from './measurement-transform.js';
import {numeralClipboardControls,wireNumeralClipboard} from './numeral-clipboard-ui.js';

const defaultText=key=>messages[key];
const initial=spelling=>({spelling,representation:'decimal',radix:10});
const get=(root,name)=>root.querySelector('[data-projection-'+name+']');
const axisRoot=(root,axis)=>root.querySelector('[data-projection-axis="'+axis+'"]');

// The draft may be incomplete while a column window changes. Reading with
// validate:false retains that draft; actual submission uses full validation.
export function measurementTransformControls(projection,{esc,field,xKind='number',resourcePolicy,text=defaultText,numberText=key=>numberMessages[key]}){
 const quantity=(kind,value)=>'<fieldset data-numeral-scope data-projection-quantity="'+kind+'"><legend>'+esc(text(kind))+'</legend>'+field(esc(text('spelling')),'<input data-projection-spelling type="text" maxlength="'+(resourcePolicy?65536:8192)+'" spellcheck="false" value="'+esc(value.spelling)+'">')+field(esc(text('representation')),'<select data-projection-representation>'+NUMBER_REPRESENTATIONS.map(v=>'<option value="'+v+'"'+(v===value.representation?' selected':'')+'>'+esc(numberText(v))+'</option>').join('')+'</select>')+'<div data-projection-base'+(numeralUsesRadix(value.representation)?'':' hidden')+'>'+field(esc(text('radix')),'<input data-projection-radix type="number" min="2" max="36" step="1" value="'+esc(value.radix)+'">')+'</div>'+numeralClipboardControls({esc})+'</fieldset>';
 return '<div data-measurement-transform><h3>'+esc(text('heading'))+'</h3><p>'+esc(text('help'))+'</p>'+['x','y'].map(axis=>{
  const value=projection?.[axis],enabled=value!==undefined,incompatible=axis==='x'&&xKind!=='number';
  return '<fieldset data-projection-axis="'+axis+'"><legend>'+esc(text(axis))+'</legend><label><input data-projection-enabled type="checkbox"'+(enabled?' checked':'')+(incompatible&&!enabled?' disabled':'')+'> '+esc(text('enable'))+'</label><p data-projection-incompatible'+(incompatible?'':' hidden')+'>'+esc(text('numericX'))+'</p><fieldset data-projection-values'+(enabled?'':' hidden')+(!enabled||incompatible?' disabled':'')+'>'+quantity('origin',value?.origin??initial('0'))+quantity('scale',value?.scale??initial('1'))+'</fieldset></fieldset>';
 }).join('')+'<p>'+esc(text('reduction'))+'</p></div>';
}
export function readMeasurementTransform(root,{xKind='number',validate=true,resourcePolicy,text=defaultText}={}){
 const value=resourcePolicy?{version:2,resourcePolicy:structuredClone(resourcePolicy)}:{version:1};
 for(const axis of ['x','y']){
  const node=axisRoot(root,axis);if(!node||!get(node,'enabled').checked)continue;
  value[axis]=Object.fromEntries(['origin','scale'].map(kind=>{
   const q=node.querySelector('[data-projection-quantity="'+kind+'"]'),representation=get(q,'representation').value;
   return [kind,{spelling:get(q,'spelling').value,representation,radix:numeralUsesRadix(representation)?Number(get(q,'radix').value):10}];
  }));
 }
 if(!value.x&&!value.y)return undefined;
 if(validate){
  if(value.x&&xKind!=='number')throw new RangeError(text('numericX'));
  validateMeasurementProjection(value);
 }
 return value;
}
export function wireMeasurementTransforms(root,{xKind=()=> 'number',resourcePolicy,guard=()=>{},available=()=>true}={}){
 const controller=new AbortController();
 const fields=control=>{const node=control.closest('[data-projection-quantity]');return node&&root.contains(node)?{spelling:get(node,'spelling'),representation:get(node,'representation'),radix:get(node,'radix')}:null;};
 const refresh=()=>{
  for(const axis of ['x','y']){
   const node=axisRoot(root,axis);if(!node)continue;
   const enabled=get(node,'enabled'),values=get(node,'values'),incompatible=axis==='x'&&xKind()!=='number';
   // Keep an incompatible checked transform visible and removable. Never drop
   // an authored transform merely because its source type was changed.
   enabled.disabled=incompatible&&!enabled.checked;values.hidden=!enabled.checked;values.disabled=!enabled.checked||incompatible;get(node,'incompatible').hidden=!incompatible;
   for(const q of node.querySelectorAll('[data-projection-quantity]'))get(q,'base').hidden=!numeralUsesRadix(get(q,'representation').value);
  }
 };
 for(const node of root.querySelectorAll('[data-projection-enabled],[data-projection-representation]'))node.addEventListener('change',refresh,{signal:controller.signal});
 const stopClipboard=wireNumeralClipboard(root,{fields,guard,maxLength:65536,resourcePolicy:control=>typeof resourcePolicy==='function'?resourcePolicy(root,control):resourcePolicy,available:control=>{
  const input=fields(control)?.spelling,dialog=root.closest('dialog');
  return !!input&&input.isConnected&&!input.readOnly&&!input.matches(':disabled')&&!input.closest('[inert],[hidden]')&&!control.closest('[inert],[hidden]')&&(!dialog||dialog.open)&&!root.dataset.busy&&root.getAttribute('aria-busy')!=='true'&&available(control);
 }});
 refresh();return {refresh,dispose(){controller.abort();stopClipboard();}};
}
export function measurementTransformDescription(projection,{esc,text=defaultText,numberText=key=>numberMessages[key]}){
 if(!validMeasurementProjection(projection))return '';
 return '<aside class="measurement-transform measurement-details"><h4>'+esc(text('retained'))+'</h4><dl>'+['x','y'].filter(axis=>projection[axis]).map(axis=>'<dt>'+esc(text(axis))+'</dt><dd>'+['origin','scale'].map(kind=>{const q=projection[axis][kind];return esc(text(kind))+': '+esc(q.spelling)+' ('+esc(numberText(q.representation))+(numeralUsesRadix(q.representation)?', '+esc(text('radix'))+': '+q.radix:'')+')';}).join('; ')+'</dd>').join('')+'</dl><p>'+esc(text('sourceValues'))+'</p></aside>';
}
