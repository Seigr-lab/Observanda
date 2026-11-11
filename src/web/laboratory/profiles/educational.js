import {defineProfile,section,text} from '../profile-definition.js';
// Text: the labBookProfiles catalogue, keys educational.<section>.*
export default defineProfile({id:'educational',version:1,icon:'book',
 sections:[
  section('activities',[text('field1'),text('field2')]),
  section('sessions',[text('field1'),text('field2')]),
  section('work',[text('field1'),text('field2')]),
  section('feedback',[text('field1'),text('field2')])
 ]
});
