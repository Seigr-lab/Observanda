import {defineProfile,section,text} from '../profile-definition.js';
// Text: the labBookProfiles catalogue, keys research-development.<section>.*
export default defineProfile({id:'research-development',version:1,icon:'flask',
 sections:[
  section('questions',[text('field1'),text('field2')]),
  section('protocols',[text('field1'),text('field2')]),
  section('experiments',[text('field1'),text('field2')]),
  section('findings',[text('field1'),text('field2')])
 ]
});
