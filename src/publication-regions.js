import {publicationText} from './web/publication-messages.js';

// Render only admitted region definitions. Their private authoring names are
// deliberately absent from both landmarks and mobile disclosure labels.
export function publicationSidebars(regions,{esc,render,editing=false}){
 const sidebars=regions.filter(region=>['sidebar','secondary-sidebar'].includes(region.kind));
 const sides=['left','right'].filter(side=>sidebars.some(region=>region.side===side));
 const widths=side=>sidebars.filter(region=>region.side===side).map(region=>'minmax(0,'+region.width+'px)');
 const rules='--sidebar-columns:'+ [...widths('left'),'minmax(0,1fr)',...widths('right')].join(' ');
 const groups=Object.fromEntries(['left','right'].map(side=>{
  const items=sidebars.filter(region=>region.side===side);
  return [side,items.map(region=>{
   const label=region.mobileTitle?.trim()||publicationText('sidebar');
   const content=region.mobile==='collapsed'?'<details class="sidebar-disclosure"'+(editing?' open':'')+'><summary>'+esc(label)+'</summary>'+render(region)+'</details>':render(region);
   return '<aside class="site-sidebar'+(region.sticky?' sidebar-sticky':'')+'" data-region-kind="'+region.kind+'" aria-label="'+esc(label)+'">'+content+'</aside>';
  }).join('')];
 }));
 return {classes:sidebars.length?' with-sidebar'+sides.map(side=>' sidebar-'+side).join(''):'',rules:sidebars.length?rules:'',...groups};
}
