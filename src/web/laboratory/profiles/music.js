// Record-keeping references, reviewed 2026-11-11:
// https://www.iasa-web.org/tc04/audio-preservation (IASA TC-04: retain originals, technical metadata, checksums)
// https://tech.ebu.ch/publications/r128 (EBU R 128: integrated loudness in LUFS, true peak in dBTP)
// https://isrc.ifpi.org/en/isrc-standard/handbook (ISRC: identifier of a recording)
// https://www.iswc.org/ (ISWC: identifier of a musical work)
// The work, session, take, derivative, annotation and release distinctions
// follow the shared music model of the development plan (section 22). Prompts
// record what the author states; Observanda does not certify rights or verify
// how an external tool produced a result.
import {defineProfile,section,text,number,date,select,unit} from '../profile-definition.js';
// Text: the labBookProfiles catalogue, keys music.<section>.*
export default defineProfile({id:'music',version:1,icon:'book',
 tracking:{subjects:['work','session','take','release'],primary:'session',events:['session','take','derivative','listening','performance','credits','release','reflection']},
 sections:[
  section('work',[text('title'),select('state',['idea','in-progress','session-captured','source-retained','selected-edition']),text('form'),text('key-tempo'),text('instrumentation'),text('writers'),text('version'),text('iswc',{format:'identifier'}),text('lyrics'),text('notes')]),
  section('session',[select('kind',['writing','rehearsal','recording','mixing','evaluation','other']),text('works'),text('participants'),text('location'),text('setup'),text('goals'),text('observations'),text('next-steps')]),
  section('take',[text('file',{format:'identifier'}),text('take'),text('works'),text('device'),number('sample-rate','Hz'),number('bit-depth',unit('bits')),number('channels',unit('channels')),number('duration',unit('seconds')),text('format'),text('sha256',{format:'sha-256'}),select('status',['kept','alternate','abandoned','failed']),text('notes')]),
  section('derivative',[select('process',['edit','mix','master','stem','render','transcode']),text('sources'),text('tool'),text('settings'),text('file',{format:'identifier'}),text('sha256',{format:'sha-256'}),number('loudness','LUFS'),number('true-peak','dBTP'),select('provenance',['declared','verified']),text('notes')]),
  section('listening',[text('source'),select('timing',['time','samples','bars']),text('position'),text('monitoring'),text('observation'),text('action')]),
  section('performance',[text('venue'),text('set-list'),text('performers'),text('technical'),text('recording'),text('notes')]),
  section('credits',[text('subject'),text('public-credit'),text('roles'),text('rights'),text('agreements'),text('isrc',{format:'identifier'}),text('licence'),select('attribution',['confirmed','unresolved','disputed'])]),
  section('release',[text('title'),text('edition'),date('released'),text('contents'),text('artwork'),text('catalogue-number',{format:'identifier'}),text('barcode',{format:'identifier'}),text('channels'),text('master-sha256',{format:'sha-256'}),select('review',['working','candidate','delivered'])]),
  section('reflection',[text('context'),text('response'),text('decisions'),text('next-steps')])
 ]
});
