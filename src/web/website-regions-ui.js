import {regionKind,regionsOf,regionAssignment,resolveRegion,assignRegion,createRegion,removeRegion} from './website-regions.js';
import {copySectionPresentation} from './media-presentation.js';
import {newElement} from './composition-tree.js';
import {t} from './i18n/index.js';
const tr=(key,values)=>t('websiteEditor',key,values);

export function websiteRegionsUI({state,esc,field,option,area,target,checkpoint,changed,resetSelection,notify,pagePicker}){
  const expanded=new Set();
  const selected=()=>resolveRegion(state.book.website,target(),area());
  const button=(key,action)=>'<button type="button" class="button" data-action="website-region-'+action+'">'+esc(tr(key))+'</button>';
  function view(){
    const kind=area();if(kind==='body')return '';
    const website=state.book.website,region=selected(),assignment=regionAssignment(website,target(),kind),choices=regionsOf(website).definitions.filter(r=>r.kind===regionKind(kind));
    return '<section class="panel website-region-controls">'+field(tr('design'),'<select data-region-choice aria-label="'+esc(tr('design'))+'">'+option('inherit',tr('inherit'),assignment===undefined?'inherit':assignment.regionId??'none')+option('none',tr(kind==='header'?'automaticHeader':kind==='footer'?'plainFooter':'none'),assignment?.regionId===null?'none':'')+choices.map(r=>option(r.id,r.name,assignment?.regionId)).join('')+'</select>')+
      (kind==='header'?'<p class="muted">'+esc(tr('headerHelp'))+'</p>':'')+'<div class="inline-actions">'+button(kind==='header'?'createHeader':regionKind(kind)==='sidebar'?'createSidebar':'createFooter','create')+(region?button('copy','copy'):'')+'</div>'+
      (region?'<p class="muted">'+esc(tr('shared'))+'</p>'+field(tr('name'),'<input data-region-field="name" maxlength="160" required value="'+esc(region.name)+'">')+
      '<details data-region-panel="reuse" '+(expanded.has('reuse')?'open':'')+'><summary>'+esc(tr('reusing'))+'</summary><label class="checkbox"><input type="checkbox" data-region-default '+(regionAssignment(website,'*',kind)?.regionId===region.id?'checked':'')+'><span>'+esc(tr('default'))+'</span></label><p class="muted">'+esc(tr('defaultHelp'))+'</p><div class="inline-actions">'+button('choosePages','pages')+button('delete','delete')+'</div></details>'+
      '<details data-region-panel="appearance" '+(expanded.has('appearance')?'open':'')+'><summary>'+esc(tr('appearance'))+'</summary>'+(regionKind(kind)==='sidebar'?field(tr('side'),'<select data-region-field="side">'+option('left',tr('left'),region.side)+option('right',tr('right'),region.side)+'</select>')+field(tr('width'),'<input type="number" min="180" max="480" data-region-field="width" value="'+region.width+'">')+'<label class="checkbox"><input type="checkbox" data-region-field="sticky" '+(region.sticky?'checked':'')+'><span>'+esc(tr('sticky'))+'</span></label>':'')+
      (regionKind(kind)==='sidebar'?field(tr('mobileBehavior'),'<select data-region-field="mobile">'+option('expanded',tr('mobileExpanded'),region.mobile??'expanded')+option('collapsed',tr('mobileCollapsed'),region.mobile??'expanded')+'</select>')+field(tr('mobileTitle'),'<input data-region-field="mobileTitle" maxlength="160" value="'+esc(region.mobileTitle??'')+'">'):'')+field(tr('padding'),'<input type="number" min="0" max="80" data-region-field="padding" value="'+region.padding+'">')+field(tr('background'),'<input type="color" data-region-field="background" value="'+esc(region.background??state.book.website.palette.background??state.book.appearance.background)+'">')+field(tr('color'),'<input type="color" data-region-field="color" value="'+esc(region.color??state.book.website.palette.text??state.book.appearance.text)+'">')+button('resetColors','reset-colors')+'</details>'+(kind==='footer'?'<p class="muted">'+esc(tr('footerHelp'))+'</p>':'') :(kind==='footer'?field(tr('footerText'),'<textarea data-site="footer" rows="3" maxlength="1500">'+esc(website.footer)+'</textarea>'):'')+'<p class="muted">'+esc(tr('missing'))+'</p>')+'</section>';
  }
  function input(el){
    const website=state.book.website,kind=area(),region=selected();
    if(el.hasAttribute('data-region-choice')){checkpoint();assignRegion(website,target(),kind,el.value==='inherit'?undefined:el.value==='none'?null:el.value);resetSelection();changed(true);return true;}
    if(!region)return false;
    if(el.hasAttribute('data-region-default')){checkpoint();assignRegion(website,'*',kind,el.checked?region.id:undefined);changed(true);return true;}
    if(el.dataset.regionField){const key=el.dataset.regionField;let value=el.type==='checkbox'?el.checked:el.value;if(['width','padding'].includes(key)){value=Number(value);if(!Number.isInteger(value)||value<Number(el.min)||value>Number(el.max))return true;}if(key==='name'&&!value.trim())return true;checkpoint('region:'+region.id+':'+key);region[key]=value;changed();return true;}
    return false;
  }
  function action(el){
    const action=el.dataset.action;if(!action?.startsWith('website-region-'))return false;
    const website=state.book.website,kind=area(),region=selected();
    if(action==='website-region-pages'){
      if(!region)return true;const regionId=region.id;
      pagePicker.open(target(),{title:tr('pagesForDesign',{name:region.name}),help:tr('pagesHelp'),returnFocus:'[data-action="website-region-pages"]',selection:{
        has:item=>resolveRegion(state.book.website,item.target,kind)?.id===regionId,
        toggle(item,checked){
          const website=state.book.website;if(!regionsOf(website).definitions.some(r=>r.id===regionId&&r.kind===regionKind(kind)))throw Error(tr('missing'));
          if(!regionAssignment(website,item.target,kind)&&regionsOf(website).assignments.length>=5000)throw Error(tr('assignmentLimit'));
          checkpoint();assignRegion(website,item.target,kind,checked?regionId:null);if(item.target===target())resetSelection();changed(true);
        }
      }});return true;
    }
    if(action==='website-region-delete'){if(region&&confirm(tr('deleteConfirm',{name:region.name}))){checkpoint();removeRegion(website,region.id);resetSelection();changed(true);}return true;}
    if(action==='website-region-reset-colors'){if(region){checkpoint();region.background=null;region.color=null;changed(true);}return true;}
    if(!['website-region-create','website-region-copy'].includes(action))return false;
    if(regionsOf(website).definitions.length>=100){notify(tr('limit'),true);return true;}
    if(action.endsWith('copy')&&!region)return true;
    checkpoint();const copy=action.endsWith('copy')?region:null,next=createRegion(website,kind,copy?tr('copyName',{name:copy.name.slice(0,140)}):tr(kind==='header'?'newHeader':regionKind(kind)==='sidebar'?'newSidebar':'newFooter'),{copy});
    if(copy)copySectionPresentation(website,'region:'+copy.id,copy.sections,'region:'+next.id,next.sections);
    if(!copy&&kind==='footer'&&website.footer)next.sections=[{...newElement('text'),body:website.footer}];
    assignRegion(website,target(),kind,next.id);resetSelection();changed(true);return true;
  }
  function bind(){for(const panel of document.querySelectorAll('[data-region-panel]'))panel.addEventListener('toggle',()=>{if(panel.isConnected)panel.open?expanded.add(panel.dataset.regionPanel):expanded.delete(panel.dataset.regionPanel);});}
  function validate(){for(const input of document.querySelectorAll('[data-region-field]'))if(!input.checkValidity()){input.reportValidity();throw new Error(tr('invalid'));}}
  return {view,input,action,selected,bind,validate};
}
