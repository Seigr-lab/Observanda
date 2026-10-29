import {CONDITION_BASES,INPUT_KINDS,EVENT_KINDS,EVENT_EXTENTS,EVENT_CONTEXTS,TIME_MEANINGS,ASSESSMENT_OUTCOMES} from './attempt-model.js';

// Form structure belongs to the attempt editor. Text, persistence and source
// discovery are supplied by their own owners.
export function attemptForm({kind,draft,attempt,esc,message,actions=true,preparationControl=null,collectionControl=null,criterionControl=''}){
 const t=key=>esc(message(key)),name=(path,key)=>path?path+'.'+key:key;
 const field=(path,key,label=key,{options=null,required=false,max=2000,area=false}={})=>{
  const value=path?path.split('.').reduce((v,k)=>v[k],draft)[key]:draft[key],n=name(path,key);
  const control=options?'<select name="'+n+'">'+options.map(([v,l])=>'<option value="'+esc(v)+'"'+(v===value?' selected':'')+'>'+esc(l)+'</option>').join('')+'</select>':area?'<textarea name="'+n+'" maxlength="'+max+'" rows="3"'+(required?' required':'')+'>'+esc(value)+'</textarea>':'<input name="'+n+'" maxlength="'+max+'" value="'+esc(value)+'"'+(required?' required':'')+'>';
  const id='attempt-field-'+n;
  return '<div class="field"><label for="'+id+'">'+t(label)+'</label>'+control.replace(/^<(input|select|textarea)/,'<$1 id="'+id+'"')+'</div>';
 };
 const choices=values=>values.map(v=>[v,message(v)]);
 const select=(path,key,values,label=key)=>field(path,key,label,{options:choices(values)});
 const button=(key,action,data='')=>'<button type="button" class="button" data-attempt-form="'+action+'" '+data+'>'+t(key)+'</button>';
 const reference=(path,values,{multiple=false,recordsOnly=false,label='reference'}={})=>'<fieldset><legend>'+t(label)+'</legend><ul>'+values.filter(Boolean).map((r,i)=>'<li>'+esc(r.label)+' · '+esc(r.revision.slice(0,12))+' '+button('removeReference','remove-ref','data-path="'+path+'" data-index="'+i+'" data-multiple="'+multiple+'"')+'</li>').join('')+'</ul>'+button('chooseRecord','reference','data-path="'+path+'" data-multiple="'+multiple+'" data-kind="record"')+(recordsOnly?'':button('chooseMaterial','reference','data-path="'+path+'" data-multiple="'+multiple+'" data-kind="material"'))+'</fieldset>';
 const repeat=(key,fields,add)=>'<fieldset data-preparation-collection="'+key+'"><legend>'+t(key)+'</legend>'+(collectionControl?.(key)??'')+draft[key].map((row,i)=>'<section class="attempt-form-row" data-row="'+key+'.'+i+'">'+fields(key+'.'+i,row)+button('remove','remove-row','data-group="'+key+'" data-index="'+i+'"')+'</section>').join('')+button(add,'add-row','data-group="'+key+'"')+'</fieldset>';
 const reason=field('','reason','reason',{required:kind==='assessment'||!!draft.supersedes,area:true});
 let body;
 if(kind==='preparation')body=field('','applicability','applicability',{required:true,area:true})+'<p>'+t('applicabilityHelp')+'</p>'+reason+
  reference('basedOn',[draft.basedOn],{recordsOnly:true,label:'basedOn'})+reference('protocols',draft.protocols,{multiple:true,recordsOnly:true,label:'protocols'})+
  repeat('conditions',(p,c)=>field(p,'name','name',{required:true,max:160})+field(p,'value')+field(p,'unit','unit',{max:80})+select(p,'basis',CONDITION_BASES)+field(p,'reason','reason',{area:true})+reference(p+'.reference',[c.reference]),'addCondition')+
  repeat('inputs',(p,i)=>field(p,'label','label',{required:true,max:160})+select(p,'kind',INPUT_KINDS,'inputKind')+field(p,'algorithm','algorithm',{options:[['sha256','SHA-256'],['sha512','SHA-512']]})+field(p,'hash','hash',{required:true,max:128})+reference(p+'.reference',[i.reference]),'addInput')+
  repeat('observations',p=>field(p,'label','label',{required:true,area:true}),'addObservation')+
  repeat('criteria',p=>field(p,'label','label',{required:true,max:160})+field(p,'expected','expected',{area:true})+field(p,'comparator','comparator',{required:true,max:160})+field(p,'denominator','denominator',{max:500})+select(p,'scope',['prospective','exploratory'])+field(p,'reason','reason',{area:true}),'addCriterion');
 else{
  const options=attempt.preparations.map((p,i)=>[p.id,message('preparationChoice',{number:i+1,description:p.applicability.slice(0,100)})]).filter(([id])=>kind!=='assessment'||!draft.supersedes||id===draft.preparationId);
  if(kind==='event')options.unshift(['',message('noPreparation')]);
  body=(preparationControl??field('','preparationId','selectPreparation',{options}))+(kind==='event'?'<p>'+t('eventHelp')+'</p>'+select('','kind',EVENT_KINDS)+field('','label','label',{max:160})+select('','extent',EVENT_EXTENTS)+select('','context',EVENT_CONTEXTS)+field('','circumstances','circumstances',{area:true}):
   '<p>'+t('assessmentHelp')+'</p>'+criterionControl+field('','criterionId','criterion',{options:(attempt.preparations.find(p=>p.id===draft.preparationId)?.criteria??[]).filter(c=>!draft.supersedes||c.id===draft.criterionId).map(c=>[c.id,c.label])})+
   select('','outcome',ASSESSMENT_OUTCOMES)+field('','domainOutcome','domainOutcome',{max:500})+field('','observed','observed',{area:true})+field('','denominator','denominator',{max:500}));
  body+=field('','actor','actor',{max:160})+field('','source','source',{max:500})+select('time','meaning',TIME_MEANINGS,'timeMeaning')+field('time','value','timeValue',{max:300})+reason+reference('references',draft.references,{multiple:true});
 }
 return '<form id="attempt-form" data-no-draft><p>'+t('draftHelp')+'</p>'+body+'<div data-attempt-picker hidden></div><p role="alert" data-attempt-error></p>'+(actions?'<div class="dialog-actions"><button type="submit" class="button primary">'+t('save')+'</button>'+button('cancel','cancel')+'</div>':'')+'</form>';
}

export function readAttemptForm(form,draft){
 for(const [path,value] of new FormData(form)){
  const parts=path.split('.');if(parts.some(k=>['__proto__','prototype','constructor'].includes(k)))continue;
  let owner=draft;for(const k of parts.slice(0,-1))owner=owner?.[k];const key=parts.at(-1);
  if(owner&&Object.hasOwn(owner,key)&&(typeof owner[key]==='string'||path==='preparationId'&&owner[key]===null))owner[key]=value;
 }
 if(draft.time?.meaning==='unknown')draft.time.value='';
 return draft;
}
