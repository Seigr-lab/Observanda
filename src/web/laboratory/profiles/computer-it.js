// Record-keeping references, reviewed 2026-11-11:
// https://doi.org/10.1371/journal.pcbi.1003285 (Sandve et al., Ten simple rules for reproducible computational research)
// https://www.acm.org/publications/policies/artifact-review-and-badging-current (ACM artifact review: available, functional, reproduced)
// https://www.go-fair.org/fair-principles/ (FAIR data: identifiers, provenance, licence)
// https://www.iso.org/standard/70636.html (ISO/IEC 20000-1: change management records)
// Version 2 pins environments and data by digest, records runs with their
// metrics and uncertainty, and adds a system register with change records for
// operated IT systems.
import {defineProfile,section,text,number,date,select,unit} from '../profile-definition.js';
// Text: the labBookProfiles catalogue, keys computer-it.<section>.*
const v2={since:2};
export default defineProfile({id:'computer-it',version:2,icon:'code',
 tracking:{subjects:['systems','datasets'],primary:'runs',events:['environments','runs','findings','change']},
 sections:[
  section('environments',[text('field1'),text('field2'),text('commit',{format:'identifier',since:2}),text('platform',v2),text('hardware',v2),text('image-sha256',{format:'sha-256',since:2}),text('lock-sha256',{format:'sha-256',since:2}),text('variables',v2)]),
  section('datasets',[text('field1'),text('field2'),text('identifier',{format:'uri',since:2}),text('sha256',{format:'sha-256',since:2}),number('size',unit('bytes'),v2),number('records',unit('records'),v2),text('splits',v2),text('preparation',v2),select('personal-data',['none','pseudonymised','personal'],v2)]),
  section('runs',[text('field1'),text('field2'),text('command',v2),text('hardware',v2),number('duration',unit('seconds'),v2),text('metric',v2),number('value','',{since:2,uncertainty:'absolute'}),text('output-sha256',{format:'sha-256',since:2}),text('log',v2),select('status',['completed','failed','cancelled','diverged'],v2)]),
  section('findings',[text('field1'),text('field2'),text('comparison',v2),text('statistics',v2),text('threats',v2),select('reproduced',['reproduced','partially','not-reproduced','not-attempted'],v2)]),
  section('systems',[text('hostname',{format:'identifier'}),text('role'),text('operating-system'),text('asset',{format:'identifier'}),text('owner'),text('location'),select('status',['planned','in-service','maintenance','retired']),text('notes')],v2),
  section('change',[text('systems'),select('kind',['standard','normal','emergency']),text('plan'),text('risk'),text('rollback'),date('scheduled'),text('executed-by'),select('outcome',['succeeded','failed','rolled-back','partial']),text('verification')],v2)
 ]
});
