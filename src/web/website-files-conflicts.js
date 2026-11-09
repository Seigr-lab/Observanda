import {websiteDocumentMerge} from './website-document-merge.js';
import {websiteStyleMerge} from './website-style-merge.js';
import {websiteMergeChoices} from './website-three-way.js';

export function websiteConflictReview(base,draft,latest){
 if(base.path!==latest.path||base.site.id!==latest.site.id||base.pageId&&latest.pageId!==base.pageId)return null;
 const resources=new Set([...(base.protectedFiles??[]),...(latest.protectedFiles??[])].map(s=>s.toLowerCase()));
 const checks=file=>{
  if(!resources.size)return null;
  const root=new URL(file,'https://website.invalid/');
  return url=>{try{const resolved=new URL(url,root);return resolved.origin===root.origin&&resources.has(resolved.pathname.slice(1).toLowerCase());}catch{return false;}};
 };
 const choices=websiteMergeChoices();
 const sameGrants=typeof base.sourceStamp==='string'&&base.sourceStamp===latest.sourceStamp;
 const html=base.html===latest.html&&sameGrants?()=>draft.html:websiteDocumentMerge(base.html,draft.html,latest.html,choices,checks(latest.path));
 const css=websiteStyleMerge(base.css,draft.css,latest.css,choices,checks(latest.site.cssPath));
 const result=()=>{if(choices.remaining())return null;const output=html();return output===null?null:{html:output,css:css()};};
 return {...choices,result,revision:latest.site.revision,actor:latest.updatedBy};
}

export function websiteConflictPanel(tr,esc){
 let plan,index=0,offset=0,output=null;
 const windowSize=1600;
 const btn=(label,action,disabled=false)=>'<button type="button" class="button" data-action="website-files-merge-'+action+'"'+(disabled?' disabled':'')+'>'+esc(tr(label))+'</button>';
 function select(value){plan=value;index=offset=0;output=null;}
 function action(op){
  if(!plan)return false;
  if(op==='prev'||op==='next'){index=Math.max(0,Math.min(plan.rows.length-1,index+(op==='next'?1:-1)));offset=0;}
  else if(op==='earlier'||op==='later')offset=Math.max(0,offset+(op==='later'?windowSize:-windowSize));
  else if(op==='local'||op==='remote'){plan.select(index,op);output=plan.remaining()?null:plan.result();}
  else return false;
  return true;
 }
 function view(){
  if(!plan)return '';
  const current=plan.rows[index],side=plan.side(index),remaining=plan.remaining();
  const actor=plan.actor?.label??tr(plan.actor?.kind==='workspace'?'versionWorkspace':'versionUnrecorded');
  const author='<p>'+esc(tr('mergeRevision',{revision:plan.revision.slice(0,12),author:actor}))+'</p>';
  if(!current)return '<section class="panel"><h2>'+esc(tr('mergeTitle'))+'</h2>'+author+'<p>'+esc(tr('mergeUnavailable'))+'</p></section>';
  const column=(label,name)=>{
   const value=current[name],sample=value===null?tr('mergeRemoved'):value.slice(offset,offset+windowSize);
   return '<section aria-label="'+esc(tr(label))+'"><h4>'+esc(tr(label))+'</h4><pre>'+esc(sample)+'</pre></section>';
  };
  const choose=(which,label)=>'<button type="button" class="button" data-action="website-files-merge-'+which+'" aria-pressed="'+(side===which)+'">'+esc(tr(label))+'</button>';
  const length=Math.max(...['local','remote','base'].map(k=>current[k]?.length??0));
  return '<section class="panel website-merge-panel"><h2>'+esc(tr('mergeTitle'))+'</h2>'+author+
   '<p role="status">'+esc(tr('mergeProgress',{remaining,total:plan.rows.length}))+'</p>'+
   '<div class="inline-actions">'+btn('pageBack','prev',index===0)+'<span>'+esc(tr('mergePosition',{index:index+1,total:plan.rows.length}))+'</span>'+btn('pageForward','next',index===plan.rows.length-1)+'</div>'+
   '<h3>'+esc(tr('mergeKind_'+current.kind))+' · '+esc(current.label)+'</h3>'+
   '<div class="website-merge-columns">'+column('mergeBase','base')+column('localPageDraft','local')+column('latestSavedPage','remote')+'</div>'+
   (length>windowSize?'<div class="inline-actions">'+btn('pageBack','earlier',offset===0)+'<span>'+esc(tr('mergeRange',{start:offset+1,end:Math.min(offset+windowSize,length),total:length}))+'</span>'+btn('pageForward','later',offset+windowSize>=length)+'</div>':'')+
   '<div class="inline-actions">'+choose('local','mergeLocal')+choose('remote','mergeRemote')+'</div>'+
   (!remaining&&!output?'<p role="alert">'+esc(tr('mergeUnavailable'))+'</p>':'')+
   '<div class="inline-actions">'+btn('mergeSave','apply',remaining>0||!output)+'<button type="button" class="button" data-action="website-files-reopen">'+esc(tr('reopen'))+'</button></div></section>';
 }
 return {select,action,view,result:()=>output};
}
