// Site tools in a rail beside the page, each with a picture and its name, so an
// author reaches pages, menus, design and media without leaving the page.
const icon=paths=>'<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'+paths+'</svg>';
// Add, Layers and Lab book content choose the page editor's own left panel.
const PAGE_PANELS=[
 ['left-add','railAdd',icon('<path d="M12 5v14M5 12h14"/>')],
 ['left-layers','railLayers',icon('<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>')],
 ['left-content','railContent',icon('<path d="M5 4h9a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M17 7h2v13H8M8 9h6M8 13h6"/>')]
];
const TOOLS=[
 ['pages','pagePanel',icon('<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/>')],
 ['menu','menu',icon('<path d="M4 6h16M4 12h16M4 18h16"/>')],
 ['regions','regions',icon('<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 9h18M3 16h18"/>')],
 ['appearance','siteAppearance',icon('<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 0 0 16z" fill="currentColor"/>')],
 ['themes','designThemes',icon('<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.9 1.2-1.8-.5-1-.1-2.2 1.1-2.2H17a4 4 0 0 0 4-4c0-5-4-10-9-10z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/>')],
 ['styles','styleLibrary',icon('<path d="M5 19L19 5M7 5h4M5 7v4M13 19h6v-6"/>')],
 ['galleries','gallery',icon('<rect x="3" y="5" width="18" height="14" rx="1.5"/><circle cx="9" cy="10" r="1.8"/><path d="M4 18l5-5 4 4 3-3 4 4"/>')],
 ['media','recordings',icon('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9.5v5l4.5-2.5z"/>')],
 ['exchange','designExchange',icon('<path d="M7 7h11l-3-3M17 17H6l3 3"/>')],
 ['versions','versionsTitle',icon('<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>')]
];
// The rail in groups: building the page, its style, media and the whole site. A record list is an element
// in Add and Lab book content; a placed one is edited from its own button when selected.
const GROUPS=[['railBuild',['left-add','left-layers','left-content','pages','menu']],['railStyle',['appearance','themes','styles','regions']],['railMedia',['galleries','media']],['railSite',['exchange','versions']]];
const BY_ACTION=new Map([...PAGE_PANELS,...TOOLS].map(entry=>[entry[0],entry]));
// Tools whose open state is a docked panel are marked as the current tool.
const PANEL={pages:'pages',menu:'menu',regions:'regions',galleries:'gallery',media:'media',exchange:'exchange',versions:'versions'};

export function websiteToolRail({t,esc}){
 function view({mode,label,left}){
  const tool=([action,key,picture])=>{
   const current=action.startsWith('left-')?mode==='visual'&&action==='left-'+left:PANEL[action]&&PANEL[action]===mode;
   return '<button type="button" class="website-tool" data-action="website-files-'+action+'"'+(current?' aria-current="true"':'')+'>'+picture+'<span>'+esc(t(key))+'</span></button>';
  };
  return '<nav class="website-tool-rail" aria-label="'+esc(label)+'">'+GROUPS.map(([name,actions])=>'<div class="website-tool-group" role="group" aria-label="'+esc(t(name))+'"><span class="website-tool-group-name" aria-hidden="true">'+esc(t(name))+'</span>'+actions.map(action=>tool(BY_ACTION.get(action))).join('')+'</div>').join('')+'</nav>';
 }
 return {view};
}
