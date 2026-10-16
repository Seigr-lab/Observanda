import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
export function queryFixture(){
 const book=sampleNotebook(),project=book.projects[0],notebook=book.notebooks[0],source=structuredClone(book.entries[0]);
 const child={...project,id:randomUUID(),title:'Music studies',parentId:project.id},outside={...project,id:randomUUID(),title:'Separate team'};
 book.projects.push(child,outside);
 const second={...notebook,id:randomUUID(),projectId:child.id,title:'Session book'},third={...notebook,id:randomUUID(),projectId:outside.id,title:'Other book'};book.notebooks.push(second,third);
 const template=id=>({id:randomUUID(),profileId:id,label:'Study',description:'',fields:[],values:{}});
 const record=(title,date,tags,extra={})=>({...structuredClone(source),id:randomUUID(),title,occurredOn:date,tags,figures:[],sections:[],body:'Shared measurement notes',status:'completed',...extra});
 book.entries=[
  record('Summer take 1','2026-06-01',['sound','summer'],{notebookId:second.id,template:template('arts-creative'),share:false}),
  record('Summer take 2','2026-06-30',['sound','summer'],{notebookId:second.id,template:template('arts-creative'),status:'incomplete',outcome:'Recorder stopped early'}),
  record('Field visit','2026-06-15',['summer','wildlife'],{template:template('environmental-agricultural')}),
  record('Winter take','2026-01-10',['sound'],{notebookId:second.id,template:template('arts-creative')}),
  record('Summer elsewhere','2026-06-15',['sound','summer'],{notebookId:third.id,template:template('arts-creative')}),
  record('Untyped summer note','2026-06-20',['summer'],{type:'note'})
 ];
 return book;
}
