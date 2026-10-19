import {resolveHelpRoute} from './help/model.js';
import {researchId} from './research-reference.js';
import {bookSelectors,selectorAnchor} from './book-selectors.js';
const preferenceRoutes={preferences:'general','user-profile':'user','dashboard-settings':'dashboard',templates:'templates',appearance:'appearance',integrations:'integrations',storage:'storage'};
// URLs identify locations by stable IDs, never by titles or filesystem paths.
export function routeFor(state) {
  if(state.page==='websites')return '#/websites'+(state.project?'/'+state.project:'');
  if((state.websiteId||state.websiteDefaultRoute)&&['website','publishing','integrations','review','branding','appearance'].includes(state.page))return '#/websites/'+(state.websiteId??'default')+'/'+(state.page==='website'?'editor':state.page==='integrations'?'settings':state.page)+(state.page==='review'?'/'+state.preview.id:state.page==='branding'?'/'+encodeURIComponent(state.brandTarget??'home'):'');
  if(state.page==='review'&&state.preview?.releaseId)return '#/review/'+state.preview.id;
  if(state.page==='laboratory')return '#/laboratory/samples';
  if(state.page==='module')return '#/modules/'+encodeURIComponent(state.moduleId)+(state.modulePath?'/'+state.modulePath.split('/').map(encodeURIComponent).join('/'):'');
  if(state.page==='project')return '#/projects/'+state.project;
  if(state.page==='entries'&&state.notebook!=='all')return '#/notebooks/'+state.notebook+(state.bookReading?'/read':'');
  if(state.page==='entries'&&state.project)return '#/projects/'+state.project+'/records';
  if(state.page==='entries')return '#/records';
  if(state.page==='editor'||state.page==='record-reader')return '#/records/'+state.selected+(state.recordReading?'/read'+(state.recordSection?'/'+state.recordSection:''):'');
  if(state.page==='branding')return '#/branding/'+encodeURIComponent(state.brandTarget??'home');
  if(state.page==='help')return '#/preferences/help'+(state.helpTopic?'/'+state.helpTopic+(state.helpSection?'/'+state.helpSection:''):'');
  if(preferenceRoutes[state.page])return '#/preferences/'+preferenceRoutes[state.page];
  return '#/'+state.page;
}
export function resolveRoute(hash,book,{contentReading=false}={}) {
  const base={websiteDefaultRoute:false,helpTopic:null,helpSection:null,labSampleRoute:false,page:'workspace',project:null,notebook:'all',selected:null,recordReading:false,bookReading:false,recordSection:null,search:'',filter:'all',recordBrowse:null};
  const parts=hash.replace(/^#\//,'').split('/');
  if(parts[0]==='websites'){
   if(parts.length<=2)return {...base,page:'websites',project:book.projects.some(p=>p.id===parts[1])?parts[1]:null};
   if(parts[1]==='default'||researchId(parts[1])){const websiteId=parts[1]==='default'?null:parts[1],websiteDefaultRoute=parts[1]==='default',page={editor:'website',publishing:'publishing',settings:'integrations',appearance:'appearance',review:'review',branding:'branding'}[parts[2]];
    if(['website','publishing','integrations','appearance'].includes(page)&&parts.length===3)return {...base,page,websiteId,websiteDefaultRoute};
    if(page==='review'&&parts.length===4&&/^[a-f0-9]{64}$/.test(parts[3]))return {...base,page,websiteId,websiteDefaultRoute,reviewId:parts[3]};
    if(page==='branding'&&parts.length===4){const target=resolveRoute('#/branding/'+parts[3],book,{contentReading});if(target.page==='branding')return {...target,websiteId,websiteDefaultRoute};}
   }return base;
  }
  if(parts[0]==='laboratory'&&parts[1]==='samples'&&parts.length===2)return {...base,page:'laboratory',labSampleRoute:true};
  if(parts[0]==='modules'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(parts[1]??'')){try{return {...base,page:'module',moduleId:parts[1],modulePath:parts.slice(2).map(decodeURIComponent).join('/')};}catch{return base;}}
  const help=resolveHelpRoute(hash);if(help)return {...base,...help};
  if(parts[0]==='preferences'){const page=Object.keys(preferenceRoutes).find(key=>preferenceRoutes[key]===(parts[1]??'general'));if(page&&parts.length<=2)return {...base,page};}
  if(['workspace','workspaces','projects','website','appearance','publishing','laboratory','storage','migration'].includes(parts[0])&&parts.length===1)return {...base,page:parts[0]};
  if(parts[0]==='records'&&parts.length===1)return {...base,page:'entries'};
  if(contentReading&&parts[0]==='records'&&parts.length===2&&researchId(parts[1]))return {...base,page:'record-reader',selected:parts[1]};
  if(contentReading&&parts[0]==='records'&&parts[2]==='read'&&parts.length<=4&&researchId(parts[1])&&(!parts[3]||/^(?:record-(?:section|figure|table|equation|citation|block)-)?[a-f0-9-]{36}$/.test(parts[3])))return {...base,page:'record-reader',selected:parts[1],recordReading:true,recordSection:parts[3]??null};
  if(parts[0]==='projects'&&parts.length<=3){const p=book.projects.find(p=>p.id===parts[1]);if(p&&(!parts[2]||parts[2]==='records'))return {...base,page:parts[2]?'entries':'project',project:p.id};}
  if(parts[0]==='notebooks'&&(parts.length===2||parts.length===3&&parts[2]==='read')){const n=book.notebooks.find(n=>n.id===parts[1]);if(n)return {...base,page:'entries',project:n.projectId,notebook:n.id,bookReading:parts[2]==='read'};}
  if(parts[0]==='records'&&(parts.length===2||(parts[2]==='read'&&parts.length<=4))){const e=book.entries.find(e=>e.id===parts[1]),n=book.notebooks.find(n=>n.id===e?.notebookId);if(e&&n)return {...base,page:'editor',project:n.projectId,notebook:n.id,selected:e.id,recordReading:parts[2]==='read',recordSection:e.sections.some(s=>s.id===parts[3])||bookSelectors(e).some(s=>selectorAnchor(s)===parts[3])?parts[3]:null};}
  if(parts[0]==='branding'&&parts.length===2){let target;try{target=decodeURIComponent(parts[1]);}catch{return base;}if(target==='home'||target.startsWith('entry:')&&researchId(target.slice(6))||contentReading&&target.startsWith('page:')&&researchId(target.slice(5))||['project','notebook','page'].some((type,i)=>[book.projects,book.notebooks,book.pages][i].some(item=>target===type+':'+item.id)))return {...base,page:'branding',brandTarget:target};}
  if(parts[0]==='review')return parts.length===2&&/^[a-f0-9]{64}$/.test(parts[1])?{...base,page:'review',reviewId:parts[1]}:{...base,page:'website'};
  return base;
}
