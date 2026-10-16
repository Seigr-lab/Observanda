import {randomUUID} from 'node:crypto';
import {sampleNotebook} from '../src/sample.js';
import {upgradeNotebook} from '../src/model.js';
import {starterTemplate} from '../src/web/project-templates.js';
import {templateFrom} from '../src/web/notebook-schema.js';
import {documentRecord} from '../src/web/record-activity.js';
export function beekeepingFixture(){
 const book=upgradeNotebook(sampleNotebook()),notebook=book.notebooks[0];notebook.title='Apiary';notebook.configuration=starterTemplate('beekeeping').configuration;
 const source=book.entries[0];
 const record=(key,title,occurredOn='2026-09-20')=>({...structuredClone(source),id:randomUUID(),notebookId:notebook.id,type:'note',title,body:'',contributors:[],relations:[],tags:[],occurredOn,status:'completed',sections:[],figures:[],attachments:[],share:false,template:templateFrom(notebook.configuration.sections.find(s=>s.key===key))});
 const hive=record('hive','Hive 01'),other=record('hive','Hive 02'),colony=record('colony','Colony A'),inspection=record('inspection','Autumn inspection');
 hive.template.values['hive-id']='01';other.template.values['hive-id']='02';colony.template.values['colony-id']='A';
 inspection.template.values={queen:'Not seen',eggs:'Observed',extent:'Partial internal',health:'PRIVATE HEALTH NOTES'};
 documentRecord(book.id,inspection,hive);documentRecord(book.id,inspection,colony);
 book.entries=[hive,other,colony,inspection];return {book,notebook,hive,other,colony,inspection,record};
}
