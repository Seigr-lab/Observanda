// Record-keeping references, reviewed 2026-11-11:
// https://slsa.dev/spec/v1.0/provenance (build provenance: source, builder, parameters, output digests)
// https://reproducible-builds.org/docs/definition/ (bit-for-bit reproducible artefacts)
// https://csrc.nist.gov/pubs/sp/800/218/final (NIST SSDF: archive releases, provenance, integrity verification)
// https://semver.org/ (release version identifiers)
// https://adr.github.io/ (architecture decision records)
// Identifiers, commits, tags and digests are exact text fields: they are kept
// verbatim and digests are checked for their algorithm's length.
import {defineProfile,section,text,number,date,select,unit} from '../profile-definition.js';
// Text: the labBookProfiles catalogue, keys software-development.<section>.*
export default defineProfile({id:'software-development',version:1,icon:'code',
 tracking:{subjects:['repository','build','image','release'],primary:'change',events:['change','build','image','test-run','release','deployment','incident','decision']},
 sections:[
  section('repository',[text('name',{format:'identifier'}),text('url',{format:'uri'}),text('default-branch',{format:'identifier'}),select('visibility',['public','private','internal']),text('licence'),text('stack'),text('maintainers'),text('notes')]),
  section('change',[text('repository'),text('branch',{format:'identifier'}),text('base-commit',{format:'identifier'}),text('result-commit',{format:'identifier'}),text('reference'),text('goal'),text('approach'),select('outcome',['in-progress','merged','abandoned','superseded']),text('notes')]),
  section('build',[text('repository'),text('commit',{format:'identifier'}),text('build-id',{format:'identifier'}),text('toolchain'),text('command'),text('platform'),text('environment'),text('artefact',{format:'identifier'}),number('size',unit('bytes')),text('sha256',{format:'sha-256'}),text('sha512',{format:'sha-512'}),select('reproducibility',['verified','not-verified','not-reproducible']),text('log'),select('outcome',['succeeded','failed','cancelled'])]),
  section('image',[text('name',{format:'identifier'}),select('kind',['disk','container','virtual-machine','firmware','installer','archive','other']),text('format'),text('source'),text('build'),number('size',unit('bytes')),text('sha256',{format:'sha-256'}),text('sha512',{format:'sha-512'}),text('signature'),text('location',{format:'uri'}),text('notes')]),
  section('test-run',[text('subject'),text('suite'),text('environment'),text('command'),number('passed',unit('tests')),number('failed',unit('tests')),number('skipped',unit('tests')),number('duration',unit('seconds')),select('result',['passed','failed','partial','inconclusive','not-run']),text('log'),text('issues')]),
  section('release',[text('version',{format:'identifier'}),text('tag',{format:'identifier'}),text('commit',{format:'identifier'}),date('released'),select('channel',['stable','candidate','beta','nightly','internal']),text('artefacts'),text('sha256',{format:'sha-256'}),text('sha512',{format:'sha-512'}),text('signing-key',{format:'identifier'}),text('notes-url',{format:'uri'}),text('known-issues'),text('decision')]),
  section('deployment',[text('release'),text('target'),text('method'),select('verification',['matched','mismatched','not-verified']),text('observed-sha256',{format:'sha-256'}),text('rollback'),select('outcome',['succeeded','failed','rolled-back','partial']),text('notes')]),
  section('incident',[text('affected'),select('severity',['critical','major','minor','cosmetic']),text('reproduction'),text('observed'),text('expected'),text('cause'),text('fix-commit',{format:'identifier'}),select('status',['open','investigating','fixed','wont-fix','duplicate'])]),
  section('decision',[select('status',['proposed','accepted','superseded','rejected']),text('context'),text('decision'),text('alternatives'),text('consequences'),text('superseded-by')])
 ]
});
