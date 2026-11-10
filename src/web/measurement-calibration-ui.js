import {t} from './i18n/index.js';
import {calibrationStatus,validCalibrationCoverage,validCalibrationReview} from './measurement-calibration.js';

const m=(key,values)=>t('measurements',key,values);
const control=(node,name)=>node.querySelector('[data-calibration-'+name+']');
const calendar=(name,value,esc)=>'<input type="date" data-calibration-'+name+' value="'+esc(value??'')+'">';

export function calibrationReviewText(reference,review){
 return m('calibrationStatus-'+calibrationStatus(reference,review),{day:review?.on??''});
}

function coverageText(bounds){
 return bounds?m('calibrationBounds',{from:bounds.from??m('calibrationStartUnknown'),through:bounds.through??m('calibrationExpiry-'+bounds.expiry)}):'';
}

export function retainedCalibrationDescription(reference,review,{esc}){
 return '<p>'+esc(calibrationReviewText(reference,review))+'</p>'+(review?.on?'<p>'+esc(m('calibrationAssessment',{day:review.on,policy:m('calibrationPolicy-'+review.policy)}))+'</p>':'')+
  (review?.coverage?'<p>'+esc(coverageText(review.coverage))+'</p>':'');
}

export function calibrationControls(quantity,{esc,field}){
 const review=quantity.calibrationReview;
 return '<section data-calibration data-coverage="'+esc(JSON.stringify(review?.coverage??null))+'">'+
  '<p data-calibration-status role="status" aria-label="'+esc(m('calibration'))+'">'+esc(calibrationReviewText(quantity.calibration,review))+'</p><p data-calibration-bounds'+(review?.coverage?'':' hidden')+'>'+esc(coverageText(review?.coverage))+'</p>'+
  field(esc(m('calibrationObservationDay')),calendar('on',review?.on,esc))+
  field(esc(m('calibrationPolicy')),'<select data-calibration-policy>'+['inform','require-valid'].map(key=>'<option value="'+key+'"'+(key===(review?.policy??'inform')?' selected':'')+'>'+esc(m('calibrationPolicy-'+key))+'</option>').join('')+'</select>')+
  '<details data-calibration-author><summary>'+esc(m('calibrationAuthor'))+'</summary><div data-calibration-editor></div></details></section>';
}

export function readCalibrationReview(element,reference,{validate=false}={}){
 if(!element)return undefined;
 const on=control(element,'on').value||null,policy=control(element,'policy').value,coverage=JSON.parse(element.dataset.coverage);
 if(!on&&policy==='inform'&&coverage===null)return undefined;
 const value={version:1,on,policy,coverage};
 if(validate&&!validCalibrationReview(value,reference))throw RangeError(calibrationReviewText(reference,value));
 return value;
}

export function wireCalibrationReviews(root,{call,esc,field,recordId,guard,signal}){
 const active=element=>!signal.aborted&&element.isConnected;
 function reference(element){return JSON.parse(element.closest('[data-calibration-block]').querySelector('[data-provenance="ref-calibration"]').value);}
 function update(element){control(element,'status').textContent=calibrationReviewText(reference(element),readCalibrationReview(element,reference(element)));}
 root.addEventListener('input',event=>{const element=event.target.closest?.('[data-calibration]');if(element&&(event.target===control(element,'on')||event.target===control(element,'policy')))update(element);},{signal});
 const loaded=new WeakMap();
 function selected(block,metadata){
  const element=block.querySelector('[data-calibration]');
  element.dataset.coverage=JSON.stringify(metadata?.coverage??null);
  const bounds=control(element,'bounds');bounds.hidden=!metadata?.coverage;bounds.textContent=coverageText(metadata?.coverage);
  loaded.delete(element);control(element,'editor').replaceChildren();control(element,'author').open=false;
  update(element);
 }
 root.addEventListener('toggle',async event=>{
  const details=event.target;if(!details.matches?.('[data-calibration-author]')||!details.open)return;
  const element=details.closest('[data-calibration]'),editor=control(element,'editor'),ref=reference(element);
  if(!ref){editor.textContent=m('calibrationChooseEvidence');return;}
  if(loaded.has(element))return;
  const token={};loaded.set(element,token);editor.textContent=m('calibrationLoading');
  try{
   const metadata=await call('calibration-inspect',{ref},{signal});guard();
   if(!active(element)||loaded.get(element)!==token)return;
   const coverage=metadata.coverage??{from:null,expiry:'unknown',through:null};
   editor.innerHTML=field(esc(m('calibrationCertificateName')),'<input data-calibration-name maxlength="300" value="'+esc(metadata.title??'')+'">')+
    field(esc(m('calibrationFrom')),calendar('from',coverage.from,esc))+
    field(esc(m('calibrationExpiry')),'<select data-calibration-expiry>'+['unknown','dated','open'].map(key=>'<option value="'+key+'"'+(coverage.expiry===key?' selected':'')+'>'+esc(m('calibrationExpiry-'+key))+'</option>').join('')+'</select>')+
    field(esc(m('calibrationThrough')),calendar('through',coverage.through,esc))+
    '<button class="button" type="button" data-calibration-review>'+esc(m('calibrationReviewCoverage'))+'</button><div data-calibration-confirmation aria-live="polite"></div>';
   const expiry=control(element,'expiry'),through=control(element,'through'),confirmation=control(element,'confirmation');
   let draft=null,saving=false;
   const dateInput=()=>{through.disabled=expiry.value!=='dated';};dateInput();
   editor.oninput=()=>{draft=null;confirmation.replaceChildren();dateInput();};
   editor.onclick=async action=>{
    const button=action.target.closest('button');if(!button||saving||!active(element))return;
    try{
     if(button===control(element,'review')){
      const coverage={from:control(element,'from').value||null,expiry:expiry.value,through:expiry.value==='dated'?through.value||null:null};
      const title=control(element,'name').value.trim();if(!title||!validCalibrationCoverage(coverage))throw RangeError(m('calibrationInvalidCoverage'));
      draft={id:metadata.coverage?ref.id:crypto.randomUUID(),recordId:metadata.recordId??recordId,expectedRevision:metadata.coverage?ref.revision:null,evidence:metadata.evidence??ref,coverage,title};
      confirmation.innerHTML='<p>'+esc(m('calibrationCoverageReview',{title,revision:draft.evidence.revision.slice(0,12)}))+'</p><button class="button" type="button" data-calibration-save>'+esc(m('calibrationSave'))+'</button>';
     }else if(button===control(element,'save')&&draft){
      saving=true;button.disabled=true;
      const saved=await call('calibration-save',draft,{signal});guard();
      if(!active(element)||loaded.get(element)!==token)return;
      const block=element.closest('[data-calibration-block]'),input=block.querySelector('[data-provenance="ref-calibration"]');
      input.value=JSON.stringify({...saved.ref,label:saved.title});block.querySelector('[data-ref-label]').textContent=saved.title+' · '+saved.ref.revision.slice(0,12);
      selected(block,saved);input.dispatchEvent(new Event('input',{bubbles:true}));control(element,'on').focus();
     }
    }catch(error){if(active(element))confirmation.textContent=error.message;}
    finally{saving=false;if(button.isConnected)button.disabled=false;}
   };
  }catch(error){if(active(element)&&loaded.get(element)===token){loaded.delete(element);editor.textContent=error.message;}}
 },{signal,capture:true});
 return {selected};
}
