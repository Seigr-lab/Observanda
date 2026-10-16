import {t} from './i18n/index.js';
import {attemptView} from './attempt-view.js';
import {resultStatementsView} from './result-statements.js';
import {customFieldLabel} from './custom-field-presentation.js';

// The source adapter declares meaning. This UI selects and reviews a complete
// declaration; it does not translate arbitrary metadata keys into findings.
export function researchAttributeChoices(text){
 if(!text)return [];let source;try{source=JSON.parse(text);}catch{return [];}
 const choices=[],queue=[{value:source,path:'',depth:0}];let visited=0;
 while(queue.length&&visited++<2000){
  const {value,path,depth}=queue.shift();if(!value||typeof value!=='object'||depth>12)continue;
  if(value.format==='observanda-record-facts'&&value.version===1){choices.push(path);continue;}
  for(const key of Object.keys(value)){if(queue.length>=2000)break;queue.push({value:value[key],path:path+'/'+key.replaceAll('~','~0').replaceAll('/','~1'),depth:depth+1});}
 }
 return choices;
}
export function importResearchMapping(detail,esc,field){
 const message=(key,args)=>t('importResearch',key,args),mapping=detail.mapping.research,paths=researchAttributeChoices(detail.attributesText);
 if(mapping&&!paths.includes(mapping.path))paths.unshift(mapping.path);
 return '<fieldset class="import-research-mapping"><legend>'+esc(message('title'))+'</legend><p>'+esc(message('help'))+'</p>'+
  field(message('source'),'<select name="researchPath" aria-label="'+esc(message('source'))+'"><option value="">'+esc(message('none'))+'</option>'+paths.map(path=>'<option value="'+esc('path:'+path)+'" '+(mapping?.path===path?'selected':'')+'>'+esc(path||message('root'))+'</option>').join('')+'</select>')+
  (!paths.length?'<p>'+esc(message('absent'))+'</p>':'')+'<p>'+esc(message('methods'))+'</p></fieldset>';
}
export function importResearchPreview(record,esc){
 if(!record)return '';
 const message=(key,args)=>t('importResearch',key,args),reference=ref=>'<span>'+esc(ref.label??ref.kind)+' · <code>'+esc(ref.revision)+'</code></span>',template=record.template;
 return '<section class="import-research-preview" aria-label="'+esc(message('preview'))+'"><h3>'+esc(message('preview'))+'</h3><dl><dt>'+esc(message('progress'))+'</dt><dd>'+esc(message('status-'+record.status))+'</dd><dt>'+esc(message('outcome'))+'</dt><dd>'+esc(record.outcome??'')+'</dd></dl>'+
  (template?'<h4>'+esc(template.label)+'</h4><p>'+esc(template.description)+'</p><dl>'+template.fields.map(f=>'<dt>'+esc(customFieldLabel(f))+'</dt><dd>'+esc(template.values[f.key]??'')+'</dd>').join('')+'</dl>':'')+
  attemptView(record.attempt,esc,{message:(key,args)=>t('attempts',key,args),reference})+resultStatementsView(record.results,esc,{message:key=>t('analyses',key),reference})+'</section>';
}
