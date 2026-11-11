// Record-keeping references, reviewed 2026-11-11:
// https://www.iso.org/standard/66912.html (ISO/IEC 17025, 7.5 technical records: identify the item, equipment, conditions and uncertainty of each test)
// https://www.ipc.org/ipc-a-610 (IPC-A-610: acceptability of electronic assemblies)
// https://www.ipc.org/ipc-77117721 (IPC-7711/7721: rework, modification and repair of electronic assemblies)
// Version 2 gives devices and serial-numbered units their own identity, adds
// firmware records and keeps identifiers and digests exact. Books that adopted
// version 1 keep their records and adopt version 2 on request.
import {defineProfile,section,text,number,date,select} from '../profile-definition.js';
// Text: the labBookProfiles catalogue, keys physical-prototyping.<section>.*
const v2={since:2};
export default defineProfile({id:'physical-prototyping',version:2,icon:'code',
 tracking:{subjects:['device','unit'],primary:'bring-up',events:['design','assembly','bring-up','rework','findings','firmware']},
 sections:[
  section('design',[text('field1'),text('field2'),text('field3'),text('field4'),text('field5'),text('design-sha256',{format:'sha-256',since:2})]),
  section('assembly',[text('field1'),text('field2'),text('field3'),text('field4'),text('field5'),text('bom-revision',{format:'identifier',since:2}),text('serials',v2)]),
  section('bring-up',[text('field1'),text('field2'),text('field3'),text('field4'),text('field5'),text('field6'),number('ambient','°C',v2),text('instruments',v2),text('raw-data-sha256',{format:'sha-256',since:2}),select('result',['meets-criteria','outside-criteria','partial','not-completed','inconclusive'],v2)]),
  section('rework',[text('field1'),text('field2'),text('field3'),text('field4'),text('field5'),text('units',v2)]),
  section('findings',[text('field1'),text('field2'),text('field3')]),
  section('device',[text('name'),text('part-number',{format:'identifier'}),text('revision',{format:'identifier'}),text('design-files',{format:'uri'}),text('design-sha256',{format:'sha-256'}),text('designer'),select('status',['concept','prototype','pilot','released','retired']),text('notes')],v2),
  section('unit',[text('serial',{format:'identifier'}),text('device'),text('build'),date('assembled'),text('assembler'),text('firmware',{format:'identifier'}),text('firmware-sha256',{format:'sha-256'}),text('calibration'),text('location'),select('status',['in-test','working','faulty','reworked','scrapped','shipped']),text('notes')],v2),
  section('firmware',[text('version',{format:'identifier'}),text('commit',{format:'identifier'}),text('toolchain'),text('image',{format:'identifier'}),text('image-sha256',{format:'sha-256'}),text('units'),text('programmer'),select('verification',['read-back','not-verified','failed']),text('notes')],v2)
 ]
});
