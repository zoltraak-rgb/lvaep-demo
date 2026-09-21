import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nyToday,previousMonth,summarize,minutesLabel} from '../src/domain.js';
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
