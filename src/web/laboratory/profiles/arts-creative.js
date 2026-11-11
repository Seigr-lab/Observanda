// Record-keeping references, reviewed 2026-11-11:
// https://collectionstrust.org.uk/spectrum/ (Spectrum: object entry, location, loans and condition records)
// https://www.getty.edu/research/publications/electronic_publications/cdwa/ (CDWA: describing works of art and their versions)
// Works and collection items are tracked subjects: studies, sessions,
// presentations, loans and reflections link to the work they concern.
import {defineProfile,section,text,date} from '../profile-definition.js';
// Text: the labBookProfiles catalogue, keys arts-creative.<section>.*
export default defineProfile({id:'arts-creative',version:1,icon:'book',
 tracking:{subjects:['works','collections'],primary:'sessions',events:['studies','sessions','presentations','loans','reflection']},
 sections:[
  section('ideas',[text('intention'),text('influences')]),
  section('studies',[text('materials'),text('technique'),text('observations')]),
  section('works',[text('medium'),text('version'),text('dimensions'),text('rights')]),
  section('sessions',[date('sessionDate'),text('repertoire'),text('setup'),text('takes')]),
  section('presentations',[text('venue'),date('startDate'),date('endDate'),text('installation'),text('access')]),
  section('collections',[text('accession'),text('provenance'),text('location'),text('condition')]),
  section('loans',[text('parties'),text('movement'),date('dueDate'),text('agreement')]),
  section('reflection',[text('context'),text('response'),text('nextSteps')])
 ]
});
