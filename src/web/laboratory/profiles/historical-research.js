// Record-keeping references, reviewed 2026-11-11:
// https://www.ica.org/resource/isadg-general-international-standard-archival-description-second-edition/ (ISAD(G): reference code, dates, creator, custody history, access conditions)
// https://tei-c.org/release/doc/tei-p5-doc/en/html/PH.html (TEI P5: transcription of primary sources)
// https://www.loc.gov/standards/datetime/ (EDTF: uncertain and approximate dates)
// https://www.geonames.org/ and https://viaf.org/ (authority identifiers for places and people)
// Prompts keep what a source says apart from its normalized reading and from
// the researcher's interpretation; uncertainty is recorded, never resolved silently.
import {defineProfile,section,text,date,select} from '../profile-definition.js';
// Text: the labBookProfiles catalogue, keys historical-research.<section>.*
export default defineProfile({id:'historical-research',version:1,icon:'search',
 tracking:{subjects:['source','person','place','event'],primary:'examination',events:['visit','examination','analysis','correspondence']},
 sections:[
  section('source',[text('title'),select('kind',['manuscript','letter','printed','periodical','photograph','map','object','patent','official','oral','digital','other']),text('creator'),text('date-stated'),date('date'),select('certainty',['exact','approximate','inferred','unknown']),text('repository'),text('collection'),text('reference',{format:'identifier'}),text('identifier',{format:'uri'}),text('copy-sha256',{format:'sha-256'}),text('access'),text('language'),text('physical'),text('custody')]),
  section('person',[text('name-found'),text('name'),text('variants'),text('life-dates'),text('authority',{format:'uri'}),text('roles'),text('sources'),text('uncertainty')]),
  section('place',[text('name-found'),text('modern-name'),text('coordinates'),text('gazetteer',{format:'uri'}),text('jurisdiction'),text('period'),text('uncertainty')]),
  section('event',[text('description'),text('date-stated'),date('start'),date('end'),select('certainty',['exact','approximate','inferred','unknown']),text('places'),text('participants'),text('sources'),text('conflicts')]),
  section('visit',[text('archive'),text('requests',{format:'identifier'}),text('consulted'),text('reproduction'),text('copies'),text('notes')]),
  section('examination',[text('source'),text('extent'),select('conventions',['diplomatic','semi-diplomatic','normalized']),text('transcription'),text('translation'),text('physical'),text('hand'),text('legibility'),select('reliability',['eyewitness','later-primary','secondary','tertiary','unknown']),text('notes')]),
  section('analysis',[text('question'),text('sources'),text('interpretation'),text('alternatives'),select('confidence',['strong','moderate','weak','speculative']),text('open-questions')]),
  section('correspondence',[text('correspondent'),select('direction',['sent','received']),text('reference',{format:'identifier'}),text('subject'),text('response'),text('follow-up')])
 ]
});
