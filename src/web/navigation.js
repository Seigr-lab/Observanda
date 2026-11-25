import {resolveHelpRoute} from './help/model.js';
import {researchId} from './research-reference.js';
import {bookSelectors,selectorAnchor} from './book-selectors.js';
const preferenceRoutes={interface:'interface',preferences:'general','user-profile':'user','dashboard-settings':'dashboard',templates:'templates',fonts:'fonts',integrations:'integrations',agents:'agents',storage:'storage'};
// URLs identify locations by stable IDs, never by titles or filesystem paths.
export function routeFor(state) {
  if((state.websiteId||state.websiteDefaultRoute)&&['website','publishing'].includes(state.page))return '#/websites/'+(state.websiteId??'default')+'/'+(state.page==='website'?'editor':state.page);
  if(state.page==='laboratory')return '#/laboratory/samples';
  if(state.page==='module')return '#/modules/'+encodeURIComponent(state.moduleId)+(state.modulePath?'/'+state.modulePath.split('/').map(encodeURIComponent).join('/'):'');
  if(state.page==='project')return '#/projects/'+state.project;
  if(state.page==='entries'&&state.notebook!=='all')return '#/notebooks/'+state.notebook+(state.bookReading?'/read':'');
  if(state.page==='entries'&&state.project)return '#/projects/'+state.project+'/records';
  if(state.page==='entries')return '#/records';
  if(state.page==='editor'||state.page==='record-reader')return '#/records/'+state.selected+(state.recordReading?'/read'+(state.recordSection?'/'+state.recordSection:''):'');
  if(state.page==='help')return '#/preferences/help'+(state.helpTopic?'/'+state.helpTopic+(state.helpSection?'/'+state.helpSection:''):'');
  if(preferenceRoutes[state.page])return '#/preferences/'+preferenceRoutes[state.page];
  return '#/'+state.page;
}
export function resolveRoute(hash,book,{contentReading=false}={}) {
  const base={websiteDefaultRoute:false,helpTopic:null,helpSection:null,labSampleRoute:false,page:'workspace',project:null,notebook:'all',selected:null,recordReading:false,bookReading:false,recordSection:null,search:'',filter:'all',recordBrowse:null};
  const parts=hash.replace(/^#\//,'').split('/');
  // Addresses of the earlier website screens lead into the website editor;
  // a website's former settings open its publishing destination.
  if(parts[0]==='websites'){
   if(parts.length<=2)return {...base,page:'website'};
   if(parts[1]==='default'||researchId(parts[1])){const websiteId=parts[1]==='default'?null:parts[1],websiteDefaultRoute=parts[1]==='default',page=['publishing','settings'].includes(parts[2])?'publishing':'website';
    if(parts[2]==='editor'||parts[2]==='publishing'?parts.length===3:['settings','appearance','review','branding'].includes(parts[2]))return {...base,page,websiteId,websiteDefaultRoute};
   }return base;
  }
  if(['branding','review'].includes(parts[0]))return {...base,page:'website'};
  if(parts[0]==='laboratory'&&parts[1]==='samples'&&parts.length===2)return {...base,page:'laboratory',labSampleRoute:true};
  if(parts[0]==='modules'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(parts[1]??'')){try{return {...base,page:'module',moduleId:parts[1],modulePath:parts.slice(2).map(decodeURIComponent).join('/')};}catch{return base;}}
  const help=resolveHelpRoute(hash);if(help)return {...base,...help};
  if(parts[0]==='preferences'&&parts[1]==='appearance'&&parts.length===2)return {...base,page:'website'};
  if(parts[0]==='preferences'){const page=Object.keys(preferenceRoutes).find(key=>preferenceRoutes[key]===(parts[1]??'general'));if(page&&parts.length<=2)return {...base,page};}
  if(['workspace','tools','workspaces','projects','website','publishing','laboratory','storage','migration'].includes(parts[0])&&parts.length===1)return {...base,page:parts[0]};
  if(parts[0]==='appearance'&&parts.length===1)return {...base,page:'website'};
  if(parts[0]==='records'&&parts.length===1)return {...base,page:'entries'};
  if(contentReading&&parts[0]==='records'&&parts.length===2&&researchId(parts[1]))return {...base,page:'record-reader',selected:parts[1]};
  if(contentReading&&parts[0]==='records'&&parts[2]==='read'&&parts.length<=4&&researchId(parts[1])&&(!parts[3]||/^(?:record-(?:section|figure|table|equation|citation|block)-)?[a-f0-9-]{36}$/.test(parts[3])))return {...base,page:'record-reader',selected:parts[1],recordReading:true,recordSection:parts[3]??null};
  if(parts[0]==='projects'&&parts.length<=3){const p=book.projects.find(p=>p.id===parts[1]);if(p&&(!parts[2]||parts[2]==='records'))return {...base,page:parts[2]?'entries':'project',project:p.id};}
  if(parts[0]==='notebooks'&&(parts.length===2||parts.length===3&&parts[2]==='read')){const n=book.notebooks.find(n=>n.id===parts[1]);if(n)return {...base,page:'entries',project:n.projectId,notebook:n.id,bookReading:parts[2]==='read'};}
  if(parts[0]==='records'&&(parts.length===2||(parts[2]==='read'&&parts.length<=4))){const e=book.entries.find(e=>e.id===parts[1]),n=book.notebooks.find(n=>n.id===e?.notebookId);if(e&&n)return {...base,page:'editor',project:n.projectId,notebook:n.id,selected:e.id,recordReading:parts[2]==='read',recordSection:e.sections.some(s=>s.id===parts[3])||bookSelectors(e).some(s=>selectorAnchor(s)===parts[3])?parts[3]:null};}
  return base;
}
