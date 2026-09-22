import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nyToday,previousMonth,summarize,minutesLabel,monthlyReportMembers,calendarDays} from '../src/domain.js';
test('New York reporting date handles UTC midnight and both daylight-saving offsets',()=>{
  assert.equal(nyToday(new Date('2026-09-01T02:00:00Z')),'2026-08-31');
  assert.equal(nyToday(new Date('2026-03-08T06:59:00Z')),'2026-03-08');
  assert.equal(nyToday(new Date('2026-11-01T06:01:00Z')),'2026-11-01');
  assert.equal(previousMonth('2026-01-01'),'2025-12');
});
test('report counts shared teaching once and unique students across tutors',()=>{
  const lessons=[
    {lesson_date:'2026-08-31',minutes:90,attendance:[{student_id:'a',minutes:90},{student_id:'b',minutes:45}]},
    {lesson_date:'2026-08-12',minutes:30,attendance:[{student_id:'a',minutes:30}]},
    {lesson_date:'2026-08-12',minutes:500,voided:true,attendance:[]},
    {lesson_date:'2026-09-01',minutes:60,attendance:[{student_id:'c',minutes:60}]}
  ];
  const report=summarize(lessons,'2026-08');
  assert.equal(report.teachingMinutes,120); assert.equal(report.studentMinutes,165); assert.equal(report.studentCount,2);
  assert.equal(minutesLabel(165),'2 hr 45 min');
});

test('monthly membership includes ended assignments, zero-session tutors and historical recorded participants',()=>{
  const members=monthlyReportMembers([
    {tutor_id:'ended',student_id:'a',starts_on:'2026-01-01',ends_on:'2026-08-01'},
    {tutor_id:'zero',student_id:'b',starts_on:'2026-08-31'},
    {tutor_id:'old',student_id:'c',starts_on:'2026-01-01',ends_on:'2026-07-31'},
    {tutor_id:'future',student_id:'d',starts_on:'2026-09-01'}
  ],[{tutor_id:'historical',lesson_date:'2026-08-03',minutes:90,attendance:[{student_id:'e',minutes:45}]}],'2026-08');
  assert.deepEqual([...members.keys()],['ended','zero','historical']);
  assert.deepEqual([...members.get('historical')],['e']);
});

test('calendar uses exact date-only days across leap years and daylight-saving months',()=>{
  assert.equal(calendarDays('2024-02').filter(Boolean).length,29);
  assert.equal(calendarDays('2025-02').filter(Boolean).length,28);
  assert.equal(calendarDays('2026-03').filter(Boolean).length,31);
  assert.equal(calendarDays('2026-11').filter(Boolean).at(-1),'2026-11-30');
  assert.equal(calendarDays('2026-09')[0],null);
  assert.deepEqual(calendarDays('2026-13'),[]);
});

test('CSV snapshot counts teaching once and separates pending, zero-session and unsafe names',async()=>{
 const {reportCsv}=await import('../src/domain.js');
 const csv=reportCsv({month:'2026-08',retrievedAt:'2026-09-22T16:00:00Z',exportedAt:'2026-09-22T16:01:00Z',people:[{id:'t',display_name:'=UNSAFE()'}],students:[{id:'s',display_name:'Name, "Quoted"'},{id:'zero',display_name:'No sessions'}],assignments:[{tutor_id:'t',student_id:'zero',starts_on:'2026-01-01'}],requests:[{id:'r',display_name:'Pending learner'}],reviewStates:{t:'Updated since review'},lessons:[{id:'l',tutor_id:'t',lesson_date:'2026-08-05',minutes:90,attendance:[{student_id:'s',minutes:60}],pending_attendance:[{request_id:'r',minutes:45}]},{id:'v',tutor_id:'t',lesson_date:'2026-08-06',minutes:100,voided:true,attendance:[]}]});
 assert.equal((csv.match(/"Lesson"/g)||[]).length,1);assert.equal((csv.match(/"90"/g)||[]).length,1);
 assert.match(csv,/"Official attendance"/);assert.match(csv,/"Pending attendance"/);assert.match(csv,/"No recorded attendance"/);assert.match(csv,/'=UNSAFE/);assert.match(csv,/Name, ""Quoted""/);assert.match(csv,/Updated since review/);assert.doesNotMatch(csv,/"100"/);
});
