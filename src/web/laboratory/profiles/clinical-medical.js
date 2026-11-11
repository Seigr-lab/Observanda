// Record-keeping references, reviewed 2026-11-11:
// https://www.iso.org/standard/76677.html (ISO 15189: medical laboratories, pre-examination, examination and post-examination records)
// https://clsi.org/standards/products/method-evaluation/documents/ep15/ (CLSI EP15: user verification of precision and bias)
// https://www.westgard.com/mltirule.htm (internal quality control rules)
// https://eur-lex.europa.eu/eli/reg/2016/679/oj (GDPR, article 9: health data is special category data)
// Version 2 adds specimen acceptance, method verification, control results,
// external quality assessment and report communication. Participant codes,
// consent and communication details are personal data: never published.
import {defineProfile,section,text,number,date,select} from '../profile-definition.js';
// Text: the labBookProfiles catalogue, keys clinical-medical.<section>.*
const v2={since:2},personal={since:2,private:true};
export default defineProfile({id:'clinical-medical',version:2,icon:'medical',
 tracking:{subjects:['methods'],primary:'quality',events:['quality','eqa','reports']},
 sections:[
  section('requests',[text('field1'),text('field2'),text('participant',personal),text('consent',personal),text('specimen-type',v2),text('collection',v2),text('transport',v2),select('acceptance',['accepted','accepted-with-comment','rejected'],v2),text('rejection',v2)]),
  section('methods',[text('field1'),text('field2'),text('measurand',v2),text('principle',v2),text('instrument',{format:'identifier',since:2}),number('precision','%',v2),number('bias','%',v2),text('reference-interval',v2),text('uncertainty',v2),text('approved-by',v2),date('effective',v2)]),
  section('quality',[text('field1'),text('field2'),text('lot',{format:'identifier',since:2}),text('level',v2),text('target',v2),number('observed','',{since:2,uncertainty:'absolute'}),text('rule',v2),select('decision',['accepted','rejected-run','accepted-with-warning'],v2),text('action',v2)]),
  section('eqa',[text('scheme'),text('round',{format:'identifier'}),text('sample',{format:'identifier'}),text('reported'),text('assigned'),number('z-score'),select('performance',['satisfactory','questionable','unsatisfactory']),text('investigation')],v2),
  section('reports',[text('field1'),text('field2'),text('report-version',{format:'identifier',since:2}),select('critical',['none','communicated','not-reached'],v2),text('communicated-to',personal),text('amendment',v2),text('authorized-by',v2)])
 ]
});
