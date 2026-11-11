import {defineProfile,section,text} from '../profile-definition.js';
// Text: the labBookProfiles catalogue, keys environmental-agricultural.<section>.*
export default defineProfile({id:'environmental-agricultural',version:1,icon:'leaf',
 sections:[
  section('sites',[text('field1'),text('field2')]),
  section('campaigns',[text('field1'),text('field2')]),
  section('observations',[text('field1'),text('field2')]),
  section('results',[text('field1'),text('field2')])
 ]
});
