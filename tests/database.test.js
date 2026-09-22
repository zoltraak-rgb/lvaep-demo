import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

let db;
const ids = Object.fromEntries(['admin','staff','tutor','other','student1','student2','hidden'].map((name,i)=>[name,`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`]));
let sequence=100;
const uuid=()=>`00000000-0000-4000-8000-${String(++sequence).padStart(12,'0')}`;
async function as(who) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[ids[who]||'']);
  await db.exec(who==='anon'?'set role anon':'set role authenticated');
}
const call=async (sql,args=[]) => (await db.query(sql,args)).rows;
const participants=(...students)=>students.map(s=>({student_id:ids[s],minutes:90}));
const save=(request=uuid(),members=participants('student1','student2'),allow=false,date='2026-08-14')=>call('select public.record_lesson($1,$2,90,$3::jsonb,$4) as result',[request,date,JSON.stringify(members),allow]);
before(async()=>{
  db=new PGlite();
  // Reproduce Supabase JWT identity and API roles locally. This is not a hosted auth test.
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon;
    grant execute on function auth.uid() to authenticated,anon;`);
  await db.exec(await readFile(new URL('../supabase/migrations/0001_foundation.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/0003_monthly_reviews.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/0004_tutor_groups.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/0005_recurring_plans.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/0006_lesson_corrections.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/0007_planned_attendance.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/0008_missing_student_requests.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/0009_pending_attendance.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/0010_pending_corrections.sql',import.meta.url),'utf8'));
  await db.exec(await readFile(new URL('../supabase/migrations/0011_request_corrections.sql',import.meta.url),'utf8'));
  for(const role of ['admin','staff','tutor','other']) {
    await db.query('insert into auth.users(id) values($1)',[ids[role]]);
    await db.query('insert into public.people(id,display_name,roles) values($1,$2,$3)',[ids[role],role,[role==='other'?'tutor':role]]);
  }
  for(const name of ['student1','student2','hidden']) await db.query('insert into public.students(id,display_name) values($1,$2)',[ids[name],name==='hidden'?'Same Name':name]);
  for(const name of ['student1','student2']) await db.query("insert into public.assignments(tutor_id,student_id,starts_on) values($1,$2,'2026-07-01')",[ids.tutor,ids[name]]);
  await db.query("insert into public.assignments(tutor_id,student_id,starts_on) values($1,$2,'2026-07-01')",[ids.other,ids.hidden]);
});
after(async()=>db?.close());

test('anonymous visitors cannot read records or call write functions',async()=>{
  await as('anon');
  await assert.rejects(call('select * from public.students'),/permission denied/);
  await assert.rejects(save(),/permission denied/);
});
test('tutors see only their own identity and assigned roster, without direct write access',async()=>{
  await as('tutor');
  assert.equal((await call('select * from public.people')).length,1);
  assert.deepEqual((await call('select id from public.students order by id')).map(x=>x.id),[ids.student1,ids.student2]);
  await assert.rejects(call("update public.people set roles=array['admin']"),/permission denied/);
  await assert.rejects(call("insert into public.students(display_name) values('Unauthorized')"),/permission denied/);
  await assert.rejects(call('select public.save_student($1,$2,false,0)',[uuid(),'Unauthorized']),/Staff access required/);
});
test('group save is atomic; partial attendance counts separately and tutor time once',async()=>{
  await as('tutor');
  const request=uuid();
  const members=[{student_id:ids.student1,minutes:90},{student_id:ids.student2,minutes:45}];
  const [saved]=await save(request,members);
  assert.equal(saved.result.status,'saved');
  const lesson=saved.result.lesson_id;
  assert.equal((await call('select minutes from public.lessons where id=$1',[lesson]))[0].minutes,90);
  assert.equal((await call('select sum(minutes)::integer as total from public.attendance where lesson_id=$1',[lesson]))[0].total,135);
  const [retry]=await save(request,[...members].reverse());
  assert.equal(retry.result.lesson_id,lesson);
  assert.equal(retry.result.replayed,true);
  assert.equal((await call('select count(*)::integer as n from public.lessons where request_id=$1',[request]))[0].n,1);
  await assert.rejects(save(request,participants('student1','student2')),/Retry contents changed/);
});
test('a same-day second lesson warns and requires deliberate confirmation',async()=>{
  await as('tutor');
  const request=uuid();
  const [warning]=await save(request);
  assert.equal(warning.result.status,'duplicate_warning');
  assert.equal(warning.result.existing.length,1);
  assert.equal((await call('select count(*)::integer as n from public.lessons where request_id=$1',[request]))[0].n,0);
  assert.equal((await save(request,participants('student1','student2'),true))[0].result.status,'saved');
});
test('invalid participant makes the entire group save fail',async()=>{
  await as('tutor');
  const request=uuid();
  await assert.rejects(save(request,participants('student1','hidden'),true),/not assigned/);
  assert.equal((await call('select count(*)::integer as n from public.lessons where request_id=$1',[request]))[0].n,0);
  await assert.rejects(save(uuid(),participants('student1','student1')),/only once/);
  await assert.rejects(save(uuid(),[{student_id:ids.student1,minutes:91}]),/cannot exceed/);
});
test('second tutor cannot read another tutor lessons, participants or audit events',async()=>{
  await as('other');
  assert.equal((await call('select * from public.lessons')).length,0);
  assert.equal((await call('select * from public.attendance')).length,0);
  assert.equal((await call('select * from public.audit_events')).length,0);
  await assert.rejects(save(uuid(),participants('student1')),/not assigned/);
});
test('lesson date controls authorization, including historical assignment end',async()=>{
  await db.exec('reset role');
  await db.query("update public.assignments set ends_on='2026-08-31' where tutor_id=$1",[ids.other]);
  await as('other');
  await assert.rejects(save(uuid(),participants('hidden'),false,'2026-09-01'),/not assigned/);
  assert.equal((await save(uuid(),participants('hidden'),false,'2026-08-31'))[0].result.status,'saved');
});
test('staff manage roster but cannot promote themselves; same-name students stay distinct',async()=>{
  await as('staff');
  const a=uuid(), b=uuid();
  await call("select public.save_student($1,'Same Name',false,0)",[a]);
  await call("select public.save_student($1,'Same Name',false,0)",[b]);
  await call("select public.save_student($1,'Same Name',false,0)",[a]);
  assert.equal((await call("select * from public.students where display_name='Same Name'")).length,3);
  await assert.rejects(call("select public.set_person_access($1,array['admin'],true,1)",[ids.staff]),/Administrator access required/);
  await assert.rejects(call("select public.save_student($1,'Stale edit',false,0)",[a]),/record changed/);
  assert.ok((await call('select * from public.audit_events')).length>0);
});
test('last administrator cannot be deactivated or demoted, and stale edits fail',async()=>{
  await as('admin');
  await assert.rejects(call("select public.set_person_access($1,array['staff'],true,1)",[ids.admin]),/last administrator/);
  await assert.rejects(call("select public.set_person_access($1,array['admin'],false,1)",[ids.admin]),/last administrator/);
  await assert.rejects(call("select public.set_person_access($1,array['admin'],true,0)",[ids.admin]),/record changed/);
  await assert.rejects(call("select public.set_person_access($1,array['admin'],true,null)",[ids.admin]),/record changed/);
});
test('deactivated tutor loses reads and writes even with an existing authenticated identity',async()=>{
  await as('admin');
  await call("select public.set_person_access($1,array['tutor'],false,1)",[ids.other]);
  await as('other');
  assert.equal((await call('select * from public.students')).length,0);
  assert.equal((await call('select * from public.lessons')).length,0);
  await assert.rejects(save(uuid(),participants('hidden')),/Tutor access required/);
});

test('assignment retry is safe; overlap and non-tutor assignments are rejected',async()=>{
  await as('staff');
  const student=uuid(), assignment=uuid();
  await call("select public.save_student($1,'New fictional learner',false,0)",[student]);
  const args=[assignment,ids.tutor,student,'2026-09-01'];
  await call('select public.assign_student($1,$2,$3,$4)',args);
  await call('select public.assign_student($1,$2,$3,$4)',args);
  assert.equal((await call('select * from public.assignments where student_id=$1',[student])).length,1);
  await assert.rejects(call('select public.assign_student($1,$2,$3,$4)',[uuid(),ids.tutor,student,'2026-09-02']),/overlapping/);
  await assert.rejects(call('select public.assign_student($1,$2,$3,$4)',[uuid(),ids.staff,student,'2026-09-01']),/active tutor/);
});

test('review requires own tutor, past month and exact displayed records; retries retain one audit event',async()=>{
  await as('tutor');
  const get=async()=> (await call("select public.get_month_review($1,'2026-08-01') as result",[ids.tutor]))[0].result;
  await assert.rejects(call("select public.get_month_review($1,'2026-08-01')",[ids.other]),/access denied/);
  let review=await get();assert.equal(review.status,'not_reviewed');
  await assert.rejects(call("select public.confirm_month_review('2026-08-01','{}'::jsonb)"),/Records changed/);
  const confirm=()=>call("select public.confirm_month_review('2026-08-01',$1::jsonb)",[JSON.stringify(review.snapshot)]);
  await confirm();await confirm();assert.equal((await get()).status,'reviewed');
  await save(uuid(),participants('student2'),true,'2026-08-22');
  assert.equal((await get()).status,'updated');
  await assert.rejects(confirm(),/Records changed/);
  review=await get();await confirm();assert.equal((await get()).status,'reviewed');
  await as('staff');
  assert.equal((await get()).status,'reviewed');
  await assert.rejects(confirm(),/Tutor access required/);
  assert.equal((await call("select * from public.audit_events where entity='monthly_review'")).length,2);
});
test('assigned tutor explicitly confirms zero sessions, while current month stays closed',async()=>{
  await as('tutor');
  const review=(await call("select public.get_month_review($1,'2026-07-01') as result",[ids.tutor]))[0].result;
  assert.equal(review.snapshot.lessons.length,0);
  await call("select public.confirm_month_review('2026-07-01',$1::jsonb)",[JSON.stringify(review.snapshot)]);
  await assert.rejects(call("select public.confirm_month_review(date_trunc('month',now() at time zone 'America/New_York')::date,'{}')"),/opens next month/);
  await as('anon');await assert.rejects(call('select * from public.monthly_reviews'),/permission denied/);
});

test('groups are tutor-owned selection shortcuts; retry and edits never change attendance',async()=>{
  await as('tutor');const id=uuid();
  const saveGroup=(name='Reading group',version=0)=>call('select public.save_tutor_group($1,$2,$3,false,$4)',[id,name,[ids.student2,ids.student1,ids.student1],version]);
  const before=await call('select * from public.attendance order by lesson_id,student_id');
  await saveGroup();await saveGroup();
  const rows=await call('select * from public.tutor_groups');assert.equal(rows.length,1);assert.equal(rows[0].student_ids.length,2);
  await assert.rejects(saveGroup('Stale change',0),/Group changed/);
  await saveGroup('Renamed',1);
  assert.deepEqual(await call('select * from public.attendance order by lesson_id,student_id'),before);
  await assert.rejects(call('select public.save_tutor_group($1,$2,$3,false,0)',[uuid(),'Invalid',[ids.hidden]]),/assigned students/);
  await as('staff');assert.equal((await call('select * from public.tutor_groups')).length,0);
  await assert.rejects(saveGroup(),/Tutor access required/);
});

test('weekly plans retry safely and one/future cancellation never changes attendance',async()=>{
 await as('tutor');const id=uuid();
 const before=await call('select * from public.attendance order by lesson_id,student_id');
 const create=()=>call("select public.create_weekly_plan($1,'2026-07-01','2026-07-22',90,$2)",[id,[ids.student2]]);
 await create();await create();
 const dates=await call('select * from public.planned_occurrences where plan_id=$1 order by lesson_date',[id]);assert.equal(dates.length,4);
 await call("select public.change_plan_occurrence($1,'one',null,null,null,true,1)",[dates[1].id]);
 assert.equal((await call('select * from public.planned_occurrences where plan_id=$1 and canceled',[id])).length,1);
 await assert.rejects(call("select public.change_plan_occurrence($1,'future',null,null,null,true,1)",[dates[2].id]),/Plan changed/);
 await call("select public.change_plan_occurrence($1,'future',null,null,null,true,2)",[dates[2].id]);
 assert.equal((await call('select * from public.planned_occurrences where plan_id=$1 and canceled',[id])).length,3);
 assert.deepEqual(await call('select * from public.attendance order by lesson_id,student_id'),before);
 await as('staff');assert.equal((await call('select * from public.planned_occurrences')).length,0);
});
test('plan dates outside assignment fail atomically and moving one preserves series dates',async()=>{
 await as('tutor');const id=uuid();
 await assert.rejects(call("select public.create_weekly_plan($1,'2026-06-24','2026-07-08',90,$2)",[id,[ids.student2]]),/not assigned/);
 assert.equal((await call('select * from public.lesson_plans where id=$1',[id])).length,0);
 await call("select public.create_weekly_plan($1,'2026-07-01','2026-07-08',90,$2)",[id,[ids.student2]]);
 const dates=await call('select * from public.planned_occurrences where plan_id=$1 order by lesson_date',[id]);
 await call("select public.change_plan_occurrence($1,'one','2026-07-02',45,$2,false,1)",[dates[0].id,[ids.student2]]);
 const moved=await call('select lesson_date::text as day,minutes from public.planned_occurrences where plan_id=$1 order by lesson_date',[id]);
 assert.deepEqual(moved,[{day:'2026-07-02',minutes:45},{day:'2026-07-08',minutes:90}]);
});

test('corrections are versioned, audited, retry-safe and invalidate prior monthly review',async()=>{
 await as('tutor');const [{result:saved}]=await save(uuid(),participants('student2'),true,'2026-08-25');
 const review=(await call("select public.get_month_review($1,'2026-08-01') as r",[ids.tutor]))[0].r;
 await call("select public.confirm_month_review('2026-08-01',$1::jsonb)",[JSON.stringify(review.snapshot)]);
 const edit=(version,minutes)=>call("select public.correct_lesson($1,$2,'2026-08-25',$3,$4::jsonb,false,true) as r",[saved.lesson_id,version,minutes,JSON.stringify([{student_id:ids.student2,minutes}])]);
 await edit(1,45);assert.equal((await edit(1,45))[0].r.replayed,true);
 await assert.rejects(edit(1,30),/Lesson changed/);
 assert.equal((await call("select public.get_month_review($1,'2026-08-01') as r",[ids.tutor]))[0].r.status,'updated');
 await as('staff');await edit(2,30);
 const audit=await call("select * from public.audit_events where entity_id=$1 and action='corrected' order by id",[saved.lesson_id]);
 assert.equal(audit.length,2);assert.equal(audit[1].actor_id,ids.staff);assert.equal(audit[0].before_value.minutes,90);
 await call("select public.correct_lesson($1,3,'2026-08-25',30,$2::jsonb,true)",[saved.lesson_id,JSON.stringify([{student_id:ids.student2,minutes:30}])]);
 assert.equal((await call('select voided from public.lessons where id=$1',[saved.lesson_id]))[0].voided,true);
 assert.equal((await call('select count(*)::integer as n from public.attendance where lesson_id=$1',[saved.lesson_id]))[0].n,1);
 await as('other');await assert.rejects(edit(4,15),/Lesson unavailable/);
});

test('planned attendance is atomic, retry-safe, owned and protected from schedule changes',async()=>{
 await as('tutor');const id=uuid(),request=uuid();
 await call("select public.create_weekly_plan($1,'2026-08-02','2026-08-09',90,$2)",[id,[ids.student1]]);
 const occurrences=await call('select * from public.planned_occurrences where plan_id=$1 order by lesson_date',[id]);
 const record=(req=request)=>call("select public.record_planned_lesson($1,1,$2,'2026-08-09',60,$3::jsonb,true) as r",[occurrences[1].id,req,JSON.stringify([{student_id:ids.student1,minutes:45}])]);
 await db.exec('reset role');await db.query("update public.people set active=true,roles=array['tutor'] where id=$1",[ids.other]);
 await as('other');await assert.rejects(record(),/Plan unavailable/);
 await as('tutor');const saved=(await record())[0].r;assert.equal((await record())[0].r.replayed,true);
 await assert.rejects(record(uuid()),/already has a saved lesson/);
 assert.equal((await call('select lesson_id from public.planned_occurrences where id=$1',[occurrences[1].id]))[0].lesson_id,saved.lesson_id);
 await call("select public.change_plan_occurrence($1,'future','2026-08-03',30,$2,false,1)",[occurrences[0].id,[ids.student1]]);
 assert.equal((await call('select lesson_date::text as day from public.planned_occurrences where id=$1',[occurrences[1].id]))[0].day,'2026-08-09');
 await assert.rejects(call("select public.change_plan_occurrence($1,'one',null,null,null,true,2)",[occurrences[1].id]),/recorded attendance/);
 await call("select public.change_plan_occurrence($1,'one',null,null,null,true,2)",[occurrences[0].id]);
 await assert.rejects(call("select public.record_planned_lesson($1,3,$2,'2026-08-03',90,$3::jsonb,true)",[occurrences[0].id,uuid(),JSON.stringify(participants('student1'))]),/canceled/);
});

test('missing student requests are private, retry-safe and never merge by name',async()=>{
 await as('tutor');const id=uuid();
 const request=(key=id,name='Same Name')=>call('select public.request_missing_student($1,$2,$3) as r',[key,name,'Met at fictional library']);
 await request();await request();await request(uuid());
 assert.equal((await call('select * from public.student_requests')).length,2);
 await assert.rejects(request(id,'Changed'),/retry does not match/);
 await assert.rejects(call("update public.student_requests set status='rejected'"),/permission denied/);
 await as('other');assert.equal((await call('select * from public.student_requests')).length,0);await assert.rejects(request(),/retry does not match/);
 await as('staff');assert.equal((await call('select * from public.student_requests')).length,2);await assert.rejects(request(uuid()),/Tutor access required/);
 await as('anon');await assert.rejects(call('select * from public.student_requests'),/permission denied/);await assert.rejects(request(uuid()),/permission denied/);
});

test('mixed pending attendance counts teaching once, persists across months and is reviewed',async()=>{
 await as('tutor');const request=uuid();await call("select public.request_missing_student($1,'Pending learner','')",[request]);
 const lessonRequest=uuid();const pending=JSON.stringify([{request_id:request,minutes:45}]);
 const record=(key,date,official='[]',extra=false)=>call('select public.record_mixed_lesson($1,$2,90,$3::jsonb,$4::jsonb,$5) as r',[key,date,official,pending,extra]);
 const official=JSON.stringify([{student_id:ids.student1,minutes:60}]);
 const saved=(await record(lessonRequest,'2026-08-27',official))[0].r;
 assert.equal((await record(lessonRequest,'2026-08-27',official))[0].r.replayed,true);
 assert.equal((await record(uuid(),'2026-08-27'))[0].r.status,'duplicate_warning');
 const totals=(await call('select l.minutes,(select sum(a.minutes)::int from public.attendance a where a.lesson_id=l.id) official,(select sum(a.minutes)::int from public.pending_attendance a where a.lesson_id=l.id) pending from public.lessons l where id=$1',[saved.lesson_id]))[0];
 assert.deepEqual(totals,{minutes:90,official:60,pending:45});
 await record(uuid(),'2026-09-02');
 const review=(await call("select public.get_month_review($1,'2026-08-01') as r",[ids.tutor]))[0].r;
 assert.equal(review.snapshot.lessons.find(l=>l.id===saved.lesson_id).pending[0].request_id,request);
 await call("select public.confirm_month_review('2026-08-01',$1::jsonb)",[JSON.stringify(review.snapshot)]);
 await as('other');assert.equal((await call('select * from public.pending_attendance')).length,0);await assert.rejects(record(uuid(),'2026-08-28'),/Pending request unavailable/);
 await as('anon');await assert.rejects(record(uuid(),'2026-08-28'),/permission denied/);
});

test('staff linking preserves reviewed lessons without confirming later pending additions',async()=>{
 await as('tutor');const req=uuid();await call("select public.request_missing_student($1,'Connect learner','')",[req]);
 const record=date=>call("select public.record_mixed_lesson($1,$2,60,'[]',$3::jsonb,true) as r",[uuid(),date,JSON.stringify([{request_id:req,minutes:40}])]);
 await record('2026-08-29');const reviewed=(await call("select public.get_month_review($1,'2026-08-01') as r",[ids.tutor]))[0].r;
 await call("select public.confirm_month_review('2026-08-01',$1::jsonb)",[JSON.stringify(reviewed.snapshot)]);
 const before=(await call("select * from public.monthly_reviews where month='2026-08-01'"))[0];
 await as('staff');await call('select public.resolve_student_request($1,$2,1)',[req,ids.student2]);
 const after=(await call("select public.get_month_review($1,'2026-08-01') as r",[ids.tutor]))[0].r;
 assert.equal(after.status,'reviewed');assert.equal(new Date(after.confirmed_at).getTime(),new Date(before.confirmed_at).getTime());
 await call('select public.resolve_student_request($1,$2,1)',[req,ids.student2]);
 await as('tutor');const req2=uuid();await call("select public.request_missing_student($1,'Another learner','')",[req2]);
 const add=date=>call("select public.record_mixed_lesson($1,$2,60,'[]',$3::jsonb,true)",[uuid(),date,JSON.stringify([{request_id:req2,minutes:30}])]);
 await add('2026-08-30');const r=(await call("select public.get_month_review($1,'2026-08-01') as r",[ids.tutor]))[0].r;await call("select public.confirm_month_review('2026-08-01',$1::jsonb)",[JSON.stringify(r.snapshot)]);
 await add('2026-08-31');await as('staff');await call('select public.resolve_student_request($1,$2,1)',[req2,ids.student2]);
 assert.equal((await call("select public.get_month_review($1,'2026-08-01') as r",[ids.tutor]))[0].r.status,'updated');
});

test('pending corrections enforce durations, retry safely, warn on overlaps and retain void history',async()=>{
 await as('tutor');const req=uuid();await call("select public.request_missing_student($1,'Correction learner','')",[req]);
 const pending=minutes=>JSON.stringify([{request_id:req,minutes}]);
 const record=async date=>(await call("select public.record_mixed_lesson($1,$2,90,'[]',$3::jsonb,true) as r",[uuid(),date,pending(75)]))[0].r.lesson_id;
 const id=await record('2026-08-23');await record('2026-08-24');
 const correct=(version,date,minutes,attendance,voided=false,allow=false)=>call("select public.correct_mixed_lesson($1,$2,$3,$4,'[]',$5,$6::jsonb,$7) as r",[id,version,date,minutes,voided,pending(attendance),allow]);
 await assert.rejects(call("select public.correct_lesson($1,1,'2026-08-23',60,'[]',false,false)",[id]),/Invalid pending attendance duration/);
 assert.equal((await correct(1,'2026-08-24',60,50))[0].r.status,'duplicate_warning');
 assert.equal((await call('select version from public.lessons where id=$1',[id]))[0].version,1);
 await as('other');await assert.rejects(correct(1,'2026-08-23',60,50),/Lesson unavailable/);
 await as('tutor');const review=(await call("select public.get_month_review($1,'2026-08-01') as r",[ids.tutor]))[0].r;
 await call("select public.confirm_month_review('2026-08-01',$1::jsonb)",[JSON.stringify(review.snapshot)]);
 await correct(1,'2026-08-23',60,50);
 assert.equal((await correct(1,'2026-08-23',60,50))[0].r.replayed,true);
 assert.equal((await call("select public.get_month_review($1,'2026-08-01') as r",[ids.tutor]))[0].r.status,'updated');
 await assert.rejects(correct(1,'2026-08-23',60,40),/Lesson changed/);
 await assert.rejects(correct(2,'2026-08-23',60,40,true),/without other changes/);
 await correct(2,'2026-08-23',60,50,true);
 assert.equal((await correct(2,'2026-08-23',60,50,true))[0].r.replayed,true);
 assert.equal((await call('select minutes from public.pending_attendance where lesson_id=$1',[id]))[0].minutes,50);
 await as('staff');
 const audit=(await call("select before_value,after_value from public.audit_events where entity_id=$1 and action='corrected'",[id]))[0];
 assert.equal(audit.before_value.pending[0].minutes,75);assert.equal(audit.after_value.pending[0].minutes,50);
});

test('staff identity linking invalidates stale corrections without recounting teaching',async()=>{
 await as('tutor');const req=uuid();await call("select public.request_missing_student($1,'Concurrent learner','')",[req]);
 const official=JSON.stringify([{student_id:ids.student1,minutes:60}]);
 const id=(await call('select public.record_mixed_lesson($1,\'2026-08-22\',90,$2::jsonb,$3::jsonb,true) as r',[uuid(),official,JSON.stringify([{request_id:req,minutes:45}])]))[0].r.lesson_id;
 await as('staff');await call('select public.resolve_student_request($1,$2,1)',[req,ids.student2]);
 await as('tutor');await assert.rejects(call("select public.correct_lesson($1,1,'2026-08-22',90,$2::jsonb,false,false)",[id,official]),/Lesson changed/);
 assert.equal((await call('select minutes,version from public.lessons where id=$1',[id]))[0].minutes,90);
 assert.equal((await call('select * from public.attendance where lesson_id=$1',[id])).length,2);
});

test('planned mixed attendance links exactly one lesson and rejects reuse',async()=>{
 await as('tutor');const plan=uuid(),req=uuid(),key=uuid();
 await call("select public.request_missing_student($1,'Planned guest','')",[req]);
 await call("select public.create_weekly_plan($1,'2026-08-19','2026-08-19',90,$2)",[plan,[ids.student1]]);
 const occurrence=(await call('select id from public.planned_occurrences where plan_id=$1',[plan]))[0].id;
 const record=(request=key)=>call("select public.record_mixed_planned_lesson($1,1,$2,'2026-08-19',90,$3::jsonb,$4::jsonb,true) as r",[occurrence,request,JSON.stringify([{student_id:ids.student1,minutes:60}]),JSON.stringify([{request_id:req,minutes:45}])]);
 const first=(await record())[0].r;assert.equal((await record())[0].r.replayed,true);
 assert.equal((await call('select lesson_id from public.planned_occurrences where id=$1',[occurrence]))[0].lesson_id,first.lesson_id);
 await assert.rejects(record(uuid()),/already has a saved lesson/);
 await as('other');await assert.rejects(record(),/Plan unavailable/);
});

test('upgrading existing confirmations preserves reviewed and changed states without new tutor actions',async()=>{
 const upgrade=new PGlite();
 try{
  await upgrade.exec(`create role anon;create role authenticated;create schema auth;
   create table auth.users(id uuid primary key);
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;`);
  for(const file of ['0001_foundation.sql','0003_monthly_reviews.sql','0008_missing_student_requests.sql'])await upgrade.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
  await upgrade.query('insert into auth.users(id) values($1)',[ids.tutor]);
  await upgrade.query("insert into public.people(id,display_name,roles) values($1,'Upgrade tutor',array['tutor'])",[ids.tutor]);
  await upgrade.query("insert into public.students(id,display_name) values($1,'Upgrade learner')",[ids.student1]);
  await upgrade.query("insert into public.assignments(tutor_id,student_id,starts_on) values($1,$2,'2026-07-01')",[ids.tutor,ids.student1]);
  for(const day of ['2026-07-05','2026-08-05']){
   const id=uuid();await upgrade.query('insert into public.lessons(id,tutor_id,lesson_date,minutes,request_id,request_payload) values($1,$2,$3,90,$4,\'{}\')',[id,ids.tutor,day,uuid()]);
   await upgrade.query('insert into public.attendance(lesson_id,student_id,minutes) values($1,$2,60)',[id,ids.student1]);
  }
  await upgrade.query("insert into public.monthly_reviews(tutor_id,month,reviewed_snapshot,confirmed_at) select $1,m,app_private.review_snapshot($1,m),'2026-09-01T12:00:00Z' from unnest(array['2026-07-01'::date,'2026-08-01'::date]) m",[ids.tutor]);
  await upgrade.exec("update public.lessons set minutes=100,version=version+1 where lesson_date='2026-08-05'");
  await upgrade.exec(await readFile(new URL('../supabase/migrations/0009_pending_attendance.sql',import.meta.url),'utf8'));
  const rows=(await upgrade.query('select month::text,confirmed_at,reviewed_snapshot=app_private.review_snapshot(tutor_id,month) as unchanged,reviewed_snapshot from public.monthly_reviews order by month')).rows;
  assert.equal(rows[0].unchanged,true);assert.equal(rows[1].unchanged,false);
  assert.deepEqual(rows[0].reviewed_snapshot.lessons[0].pending,[]);
  for(const row of rows)assert.equal(new Date(row.confirmed_at).toISOString(),'2026-09-01T12:00:00.000Z');
  assert.equal((await upgrade.query("select count(*)::int n from public.audit_events where entity='monthly_review'")).rows[0].n,0);
 }finally{await upgrade.close();}
});

test('rejected requests retain teaching and pending history, block new lessons, and reopen safely',async()=>{
 await as('tutor');const req=uuid();await call("select public.request_missing_student($1,'Rejected learner','')",[req]);
 const record=()=>call("select public.record_mixed_lesson($1,'2026-08-21',90,'[]',$2::jsonb,true) as r",[uuid(),JSON.stringify([{request_id:req,minutes:40}])]);
 const lesson=(await record())[0].r.lesson_id;
 await assert.rejects(call("select public.change_student_request($1,1,'reject','Unverified')",[req]),/Staff access required/);
 await as('staff');await call("select public.change_student_request($1,1,'reject','Unverified')",[req]);await call("select public.change_student_request($1,1,'reject','Unverified')",[req]);
 assert.equal((await call('select minutes from public.lessons where id=$1',[lesson]))[0].minutes,90);assert.equal((await call('select minutes from public.pending_attendance where lesson_id=$1',[lesson]))[0].minutes,40);
 await as('tutor');await assert.rejects(record(),/Pending request unavailable/);
 await as('staff');await call("select public.change_student_request($1,2,'reopen','Verified context')",[req]);await as('tutor');assert.equal((await record())[0].r.status,'saved');
});
test('undo wrong connection restores corrected attendance only once without changing teaching',async()=>{
 await as('tutor');const req=uuid();await call("select public.request_missing_student($1,'Wrong match','')",[req]);
 const lesson=(await call("select public.record_mixed_lesson($1,'2026-08-20',90,'[]',$2::jsonb,true) as r",[uuid(),JSON.stringify([{request_id:req,minutes:45}])]))[0].r.lesson_id;
 await as('staff');await call('select public.resolve_student_request($1,$2,1)',[req,ids.student2]);
 await as('tutor');await call("select public.correct_lesson($1,2,'2026-08-20',90,$2::jsonb,false,true)",[lesson,JSON.stringify([{student_id:ids.student2,minutes:50}])]);
 const review=(await call("select public.get_month_review($1,'2026-08-01') as r",[ids.tutor]))[0].r;await call("select public.confirm_month_review('2026-08-01',$1::jsonb)",[JSON.stringify(review.snapshot)]);
 await as('staff');await call("select public.change_student_request($1,2,'disconnect','Wrong person selected')",[req]);await call("select public.change_student_request($1,2,'disconnect','Wrong person selected')",[req]);
 assert.equal((await call('select minutes from public.pending_attendance where lesson_id=$1',[lesson]))[0].minutes,50);assert.equal((await call('select * from public.attendance where lesson_id=$1',[lesson])).length,0);assert.equal((await call('select minutes from public.lessons where id=$1',[lesson]))[0].minutes,90);
 assert.equal((await call("select public.get_month_review($1,'2026-08-01') as r",[ids.tutor]))[0].r.status,'updated');
 await call('select public.resolve_student_request($1,$2,3)',[req,ids.student1]);assert.equal((await call('select minutes from public.attendance where lesson_id=$1',[lesson]))[0].minutes,50);
});
