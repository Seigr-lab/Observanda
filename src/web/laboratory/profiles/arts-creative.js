import {defineProfile,section,text,date} from '../profile-definition.js';
// Text: the labBookProfiles catalogue, keys arts-creative.<section>.*
export default defineProfile({id:'arts-creative',version:1,icon:'book',
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
