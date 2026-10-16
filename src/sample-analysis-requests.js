import os from 'node:os';
import {Laboratory} from './laboratory.js';
import {SampleAnalysisReader} from './sample-analysis-reader.js';
import {researchId} from './web/research-reference.js';
import {AppError} from './errors.js';
export function sampleAnalysisRequest(route,method='POST'){
 const report=/^\/api\/laboratory\/(report|issued)\/([a-f0-9-]{36})$/.exec(route);
 if(report&&method==='GET'&&researchId(report[2]))return {sampleAnalysis:report[1],recordId:report[2],method,write:false,binary:true,limit:0};
 const operation=route==='/api/laboratory'&&method==='GET'?'read':method==='POST'?{'/api/laboratory/read/query':'query','/api/laboratory/read/selected':'selected','/api/laboratory/change':'change'}[route]:null;
 return operation?{sampleAnalysis:operation,method,write:operation==='change',limit:1024*1024}:null;
}
export async function executeSampleAnalysisRequest(storage,selected,data,{signal,check,query={},binary}={}){
 signal?.throwIfAborted();await check?.();const service=new Laboratory(storage),operation=selected.sampleAnalysis;
 if(['query','selected'].includes(operation))return new SampleAnalysisReader(service)[operation](data,{signal});
 if(operation==='read')return service.read();
 if(operation==='change'){const {commandId,...command}=data;return service.change(command,{compact:query.compact==='1',commandId:commandId??null,signal,check});}
 if(!['report','issued'].includes(operation)||!binary)throw new AppError('INVALID');
 const content=await service.report(selected.recordId,query.revision??null,[storage.root,os.homedir(),os.hostname()],{retained:operation==='issued'});await check?.();
 return binary({content:Buffer.from(content),mime:'text/html; charset=utf-8'});
}
