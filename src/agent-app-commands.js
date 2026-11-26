// The app's own commands, reached by agent keys. An agent works with the same
// commands the app's screens use (lab book data, websites, PDFs), so it can do
// what the owner does with the logged data and every check still applies.
// Passwords, keys, devices, preferences and workspace storage stay with the
// owner: those commands are not reachable with a key.
import {projectRequest} from './project-application.js';
import {pdfDocumentRequest} from './pdf-route-policy.js';
import {researchRequest} from './research-requests.js';

export const AGENT_APP_PREFIX='/api/v1/agent/app/';

const workspaceReads=new Set(['version','start','page','changes','change-page','selection','labels','dashboard','dashboard-types','record-types','discovery','timeline','record-content','record-selectors'].map(name=>'/api/workspace/read/'+name));
// Website editor commands that only read; any other is treated as a change.
const websiteReads=new Set(['session','list','open','version','starters/preview','page/review-lifecycle','page/review-inclusion','page/delivery','page/archive-list','site/review-lifecycle',
 'styles/read','themes/read','breakpoints/review','appearance/read','menu','regions','source/check','source/locate','feed/read','downloads/list','media/library','gallery/source-read',
 'library','library/search','library/facets','library/sites','library/validate','library/preview','library/gallery-items','library/saved-searches/list','library/placements',
 'library/presentation-options','library/presentation-preview','publish-target','destination','release/overview','review/catalogue','discovery/read','preparation','export/check','sandbox-preview','plan/page']);
const websiteGets=/^(preview|edition|gallery\/image)\/|^export$|^designs\/export$/;
// Reaching other workspaces' or lab books' credentials is the owner's alone.
const credentials=/(^|\/)access\/|^\/api\/projects\/move\/target\/unlock$/;

// The command an agent addresses, or null when keys cannot reach it.
export function agentAppCommand(method,pathname){
 if(!pathname.startsWith(AGENT_APP_PREFIX))return null;
 const route='/api/'+pathname.slice(AGENT_APP_PREFIX.length);
 if(route.includes('//')||/(^|\/)\.\.?(\/|$)/.test(route))return null;
 if(route.startsWith('/api/projects/')){
  const request=projectRequest(route,method);
  if(!request||credentials.test(route.slice('/api/projects/'.length))||credentials.test(route))return null;
  const book=/^\/api\/projects\/[a-f0-9-]{36}\/lab-books\/([a-f0-9-]{36})\//.exec(route);
  return {route,family:'research',write:!!request.write,projectId:request.projectId??null,labBookId:book?.[1]??null};
 }
 // The workspace's own lab book: its reads and research commands (workspace keys).
 if(method==='POST'&&workspaceReads.has(route))return {route,family:'research',write:false,workspace:true};
 const research=method==='POST'&&researchRequest(route);
 if(research)return {route,family:'research',write:!!research.write,workspace:true};
 if(method==='GET'&&route==='/api/notebook')return {route,family:'research',write:false,workspace:true};
 if(route.startsWith('/api/website-files/')){
  const operation=route.slice('/api/website-files/'.length);
  if(method==='GET')return websiteGets.test(operation)||operation==='session'?{route,family:'website',write:false,workspace:true}:null;
  return method==='POST'?{route,family:'website',write:!websiteReads.has(operation),workspace:true}:null;
 }
 if(method==='POST'&&['/api/website-record-updates/check','/api/website-analysis/check'].includes(route))return {route,family:'website',write:false,workspace:true};
 if(method==='POST'&&route==='/api/website-record-updates/apply')return {route,family:'website',write:true,workspace:true};
 const pdf=pdfDocumentRequest(route,method);
 if(pdf)return {route,family:'pdf',write:pdf.write,workspace:true};
 if(method==='GET'&&['/api/dashboard','/api/dashboard/pending'].includes(route))return {route,family:'research',write:false,workspace:true};
 return null;
}

// Whether a key's scope covers the command: website and workspace-wide commands
// need a workspace key; project and lab book commands need that project or book.
export function agentAppInScope(key,command){
 if(key.scope.kind==='workspace')return true;
 if(command.workspace||!command.projectId||command.projectId!==key.scope.projectId)return false;
 return key.scope.kind==='project'||command.labBookId===key.scope.labBookId;
}
