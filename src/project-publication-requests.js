// Publication endpoints declare their owner and admission before execution.
import {MAX_BYTES} from './model.js';
const commands={
 'github-connection/':['status','start','cancel','choose','disconnect'],
 'websites/':['list','open','version','change','save',...['open','window','item','change','undo','redo','discard','save'].map(name=>'editor/'+name)],
 'website/research/':['summary','content','record','sections','media'],
 'publication-selections/':['open','checkpoint','read','window','discard'],
 'publication-jobs/':['start','list','open','pages','references','rollback-review','analysis-review','analysis-review-window','status','cancel','retry'],
 'deployment-jobs/':['start','list','status','cancel','retry'],
 'repository-setup/':['start','review','initialize','current','status','cancel','retry'],
 'publishing/':['save','connect','disconnect','check','plan','plan-page','verify','verification','verification-cancel','verification-retry','deploy'],
 'local-export/':['plan','current','page','apply','discard'],
 'publication-links/':['read','save']
};
const reads=new Set(['publishing/plan-page','publication-selections/read','publication-selections/window',...['open','window','item'].map(name=>'websites/editor/'+name),'github-connection/status','websites/list','websites/open','websites/version','publication-jobs/list','publication-jobs/open','publication-jobs/pages','publication-jobs/references','publication-jobs/analysis-review-window','publication-jobs/status','deployment-jobs/list','deployment-jobs/status','repository-setup/current','repository-setup/status','publishing/verification','publication-links/read','publication-selection','publication-references','local-export/current','local-export/page']);
export function projectPublicationRequest(route){
 if(!route.startsWith('/api/'))return null;const operation=route.slice(5);
 const appearance=/^appearance-preview\/([a-f0-9]{64})\/(.+)$/.exec(operation);
 if(appearance)return {publication:appearance[2]==='pages'?'appearance-pages':'appearance-file',id:appearance[1],file:appearance[2],write:false,method:'GET',binary:appearance[2]!=='pages',limit:MAX_BYTES};
 if(operation==='publishing')return {publication:operation,write:false,method:'GET',limit:MAX_BYTES};
 const preview=/^publication-preview\/([a-f0-9]{64})\/(.+)$/.exec(operation),download=/^export\/([a-f0-9]{64})$/.exec(operation);
 if(preview||download)return {publication:preview?'file':'export',id:(preview??download)[1],file:preview?.[2],write:false,method:'GET',binary:true,limit:MAX_BYTES};
 if(['preview','design-preview','appearance-preview','export','workspace/save','publication-selection','publication-references'].includes(operation)||Object.entries(commands).some(([prefix,names])=>operation.startsWith(prefix)&&names.includes(operation.slice(prefix.length))))return {publication:operation,write:!reads.has(operation)&&!operation.startsWith('website/research/')&&!['design-preview','appearance-preview','export'].includes(operation),method:'POST',binary:operation==='export',limit:MAX_BYTES};
 return null;
}
