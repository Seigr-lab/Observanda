import {starterRecord} from './record-starter-model.js';

// A released starter describes what to create. Its copy carries no examples,
// membership, published grants, or links to another owner's material.
const record = (id, type, sections) => ({id, kind:'record', type, sections});
const book = (id, sections) => ({id, kind:'book', sections});
const keyboardReview=Object.freeze({method:'keyboard',controls:Object.freeze(['search','outputFilter','preview','sectionSelection','confirmation'])});
export const taskStarters = Object.freeze([
  record('blankRecord','note',[]),
  book('blankBook',[]),
  record('projectDiary','note',['work','decisions','nextSteps']),
  record('illustratedProcedure','protocol',['purpose','materials','steps','verification']),
  record('fieldVisit','observation',['context','observations','evidence','nextSteps']),
  record('lesson','note',['objectives','preparation','activity','reflection']),
  record('studioSession','run',['intention','setup','takes','nextSteps']),
  record('hiveInspection','observation',['hive','colony','actions','nextSteps']),
  book('methodsBook',['method','result'])
].map(value => Object.freeze({...value, sections:Object.freeze(value.sections), version:1,
  capability:value.kind==='book'?'notebooks':'records', examples:false, migration:'independentCopy',
  languageNamespace:'recordStarters', accessibilityReview:keyboardReview})));

const bookFields={method:['purpose','materials','steps'], result:['observations','evidence','interpretation']};

export function taskStarterDescription(starter, translate) {
  return {
    name:translate('task_'+starter.id), description:translate('task_'+starter.id+'_help'),
    sections:starter.sections.map(key=>({key,label:translate('taskSection_'+key),
      fields:starter.kind==='book' ? bookFields[key].map(field=>({key:field,label:translate('taskSection_'+field)})) : []}))
  };
}

export function createTaskRecord(starter,{title,sections,notebookId,now,uuid}) {
  if (starter.kind!=='record') throw new TypeError('Expected a record starter');
  const name=title.trim();
  return starterRecord({name,title:name,type:starter.type,body:'',tags:[],
    sections:sections.map(({label})=>({title:label,body:''}))},
    {id:uuid(),notebookId,now,uuid});
}

export function taskBookConfiguration(sections, uuid) {
  return {profiles:[],sections:sections.map(({key,label,fields})=>({
    id:uuid(),profileId:null,key,label,enabled:true,description:'',
    fields:fields.map(field=>({...field,type:'text',unit:'',required:false,choices:[]}))
  }))};
}
