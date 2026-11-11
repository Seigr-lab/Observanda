// Record-keeping references, reviewed 2026-11-11:
// https://udlguidelines.cast.org/ (CAST Universal Design for Learning guidelines: accessible activities and options)
// https://www.unesco.org/en/open-educational-resources (UNESCO recommendation on open educational resources: licences and adaptation)
// https://eur-lex.europa.eu/eli/reg/2016/679/oj (GDPR: learners' personal data, with special care for children)
// Version 2 adds courses and teaching resources, accessible activity design,
// session reflection, learner investigations and criteria-based feedback.
// Learner names and individual feedback are never published.
import {defineProfile,section,text,number,select,unit} from '../profile-definition.js';
// Text: the labBookProfiles catalogue, keys educational.<section>.*
const v2={since:2},learner={since:2,private:true};
export default defineProfile({id:'educational',version:2,icon:'book',
 tracking:{subjects:['course','activities'],primary:'sessions',events:['sessions','work','feedback']},
 sections:[
  section('course',[text('title'),text('level'),text('aims'),text('sequence'),text('assessment'),text('version',{format:'identifier'}),text('licence')],v2),
  section('activities',[text('field1'),text('field2'),text('subject-level',v2),number('duration',unit('minutes'),v2),text('materials',v2),text('safety',v2),text('accessibility',v2),text('prior-knowledge',v2),text('success-criteria',v2)]),
  section('resource',[text('title'),select('kind',['worksheet','slides','video','dataset','equipment-guide','assessment','other']),text('source'),text('licence'),select('adapted',['original','adapted','reused-unchanged']),text('accessibility')],v2),
  section('sessions',[text('field1'),text('field2'),number('group-size',unit('learners'),v2),text('staff',v2),text('room',v2),text('planned',v2),text('actual',v2),text('worked',v2),text('changes',v2)]),
  section('work',[text('field1'),text('field2',{private:2}),text('question',v2),text('method',v2),text('evidence',v2),text('conclusions',v2),text('support',learner)]),
  section('feedback',[text('field1'),text('field2'),text('evidence',v2),select('attainment',['exceeds','meets','approaching','not-yet'],v2),text('feedback',learner),text('moderation',v2)])
 ]
});
