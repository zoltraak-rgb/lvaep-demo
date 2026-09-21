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
