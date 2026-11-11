// Record-keeping references, reviewed 2026-11-11:
// https://www.iso.org/standard/72041.html (ISO 21043-2: recognition, recording, collecting, transport and storage of items)
// https://www.iso.org/standard/44381.html (ISO/IEC 27037: identification, collection, acquisition and preservation of digital evidence)
// https://csrc.nist.gov/pubs/sp/800/86/final (NIST SP 800-86: integrating forensic techniques into incident response)
// https://enfsi.eu/documents/best-practice-manuals/ (ENFSI best practice manuals: examination notes, review, reporting)
// Version 2 adds item identity and seals, an unbroken chain of custody, digital
// acquisition with verified digests, examination detail and review. Names of
// people who handed over or received items are never published.
import {defineProfile,section,text,date,select} from '../profile-definition.js';
// Text: the labBookProfiles catalogue, keys crime-forensic.<section>.*
const v2={since:2},personal={since:2,private:true};
export default defineProfile({id:'crime-forensic',version:2,icon:'search',
 tracking:{subjects:['evidence'],primary:'custody',events:['custody','acquisition','examinations','reports']},
 sections:[
  section('cases',[text('field1'),text('field2'),text('requester',personal),text('questions',v2),text('scope',v2),text('authority',v2),date('deadline',v2)]),
  section('evidence',[text('field1'),text('field2'),text('item-id',{format:'identifier',since:2}),text('description',v2),text('received-from',personal),date('received',v2),text('seal',{format:'identifier',since:2}),text('condition',v2),text('return',v2)]),
  section('custody',[text('items'),text('from',{private:true}),text('to',{private:true}),text('purpose'),select('seal-state',['intact','broken','resealed']),text('seal',{format:'identifier'}),text('time')],v2),
  section('acquisition',[text('device'),text('serial',{format:'identifier'}),text('tool'),select('write-protection',['hardware','software','none']),text('format'),text('sha256',{format:'sha-256'}),text('sha512',{format:'sha-512'}),select('verification',['matched','mismatched','not-verified']),text('notes')],v2),
  section('examinations',[text('field1'),text('field2'),text('examiner',v2),text('sop',{format:'identifier',since:2}),text('equipment',v2),text('controls',v2),text('observations',v2),text('images',v2),text('result',v2)]),
  section('reports',[text('field1'),text('field2'),text('technical-review',v2),text('administrative-review',v2),select('agreement',['agreed','disagreement-resolved','disagreement-recorded'],v2),text('version',{format:'identifier',since:2}),date('issued',v2)])
 ]
});
