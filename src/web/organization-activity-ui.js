import {t} from './i18n/index.js';

export function organizationActivityUI({esc,button,showDialog}){
  const tr=(key,values)=>t('organizations',key,values);
  const paragraph=(key,values)=>'<p>'+esc(tr(key,values))+'</p>';
  function details(event){
    const value=event.details;
    let html=event.subjectName?'<strong>'+esc(event.subjectName)+'</strong>':'';
    if(value.previousName!==undefined)html+=paragraph('activityRenamed',{name:value.previousName});
    if(value.previousRole!==undefined)html+=paragraph('activityRoleChange',{before:tr(value.previousRole),after:tr(value.role)});
    else if(value.role)html+=paragraph('activityRole',{role:tr(value.role)});
    if(value.active!==undefined)html+=paragraph('activityStatus',{status:tr(value.active?'active':'inactive')});
    if(value.members)html+=paragraph('activityMembers',{names:event.memberNames.join(', ')||tr('none')});
    if(value.previousMembers)html+=paragraph('activityPreviousMembers',{names:event.previousMemberNames.join(', ')||tr('none')});
    if(value.expiresAt)html+=paragraph('activityExpiry',{time:value.expiresAt});
    return html;
  }
  return (organization,page)=>{
    const attrs='data-organization="'+organization.id+'"';
    showDialog('<section data-organization-activity><h2 id="dialog-title">'+esc(tr('activityTitle',{name:organization.name}))+'</h2><p>'+esc(tr('activityHelp'))+'</p><ol>'+page.events.map(event=>'<li><h3>'+esc(tr('activity_'+event.operation))+'</h3><p><time datetime="'+esc(event.at)+'">'+esc(event.at)+'</time> — '+esc(event.actorName)+'</p>'+details(event)+'</li>').join('')+'</ol>'+(!page.events.length?'<p>'+esc(tr('activityEmpty'))+'</p>':'')+'<div class="dialog-actions">'+button('close','close')+button('activityLatest','activity',attrs)+(page.nextBefore?button('activityOlder','activity',attrs+' data-before="'+page.nextBefore+'"'):'')+'</div></section>');
  };
}
