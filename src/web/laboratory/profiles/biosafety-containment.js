// Record-keeping references, reviewed 2026-11-11:
// https://www.who.int/publications/i/item/9789240011311 (WHO Laboratory biosafety manual, 4th edition: risk assessment, control measures, training, incidents)
// https://www.cdc.gov/labs/bmbl/ (BMBL 6th edition: containment levels, decontamination, inventory and incident records)
// https://www.iso.org/standard/71293.html (ISO 35001: biorisk management records)
// Version 2 adds risk ratings and controls, competency evidence, equipment
// certification, an inventory of biological agents and decontamination cycles.
// Names of people and health details are never published.
import {defineProfile,section,text,number,date,select,unit} from '../profile-definition.js';
// Text: the labBookProfiles catalogue, keys biosafety-containment.<section>.*
const v2={since:2},personal={since:2,private:true};
const ratings=['low','medium','high','very-high'];
export default defineProfile({id:'biosafety-containment',version:2,icon:'shield',
 tracking:{subjects:['facilities','inventory'],primary:'decontamination',events:['assessments','training','incidents','decontamination']},
 sections:[
  section('assessments',[text('field1'),text('field2'),text('agents',v2),select('risk-group',['1','2','3','4','not-classified'],v2),text('procedures',v2),select('likelihood',ratings,v2),select('consequence',ratings,v2),select('initial-risk',ratings,v2),text('controls',v2),select('residual-risk',ratings,v2),text('approved-by',v2),date('review',v2)]),
  section('training',[text('field1'),text('field2'),text('person',personal),text('course',v2),text('trainer',v2),date('completed',v2),select('competency',['demonstrated','supervised','not-yet'],v2),date('reassessment',v2)]),
  section('facilities',[text('field1'),text('field2'),select('containment',['1','2','3','4'],v2),text('equipment-id',{format:'identifier',since:2}),text('test',v2),number('airflow','m/s',{since:2,uncertainty:'absolute'}),select('result',['pass','fail','conditional'],v2),text('certifier',v2),date('next-due',v2)]),
  section('inventory',[text('agent'),text('strain',{format:'identifier'}),select('risk-group',['1','2','3','4','not-classified']),text('location'),text('quantity'),date('received'),text('source'),text('permits'),text('disposition')],v2),
  section('decontamination',[text('equipment',{format:'identifier'}),text('cycle',{format:'identifier'}),text('program'),number('temperature','°C'),number('duration',unit('minutes')),text('load'),select('indicator',['pass','fail','not-used']),text('operator')],v2),
  section('incidents',[text('field1'),text('field2'),select('kind',['spill','exposure','injury','equipment-failure','near-miss','security'],v2),text('agents',v2),text('people',personal),text('immediate',v2),text('medical',personal),text('cause',v2),text('corrective',v2),text('reported-to',v2)])
 ]
});
