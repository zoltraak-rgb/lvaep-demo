import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
test('public sample accounts seed real records, reviews and role boundaries',async()=>{
 const db=new PGlite();
 try {
 await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;insert into auth.users values('00000000-0000-4000-8000-000000000001','tutor@lvaep-demo.example'),('00000000-0000-4000-8000-000000000002','staff@lvaep-demo.example');`);
 for(const file of (await readdir(new URL('../supabase/migrations/',import.meta.url))).sort().filter(f=>f.endsWith('.sql')&&!f.startsWith('0002')))await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../setup/public-demo-seed.sql',import.meta.url),'utf8'));
 assert.equal((await db.query('select count(*)::int n from public.students')).rows[0].n,3);
 assert.equal((await db.query('select count(*)::int n from public.lessons')).rows[0].n,15);
 assert.equal((await db.query('select count(*)::int n from public.monthly_reviews')).rows[0].n,1);
 assert.equal((await db.query("select count(*)::int n from public.people where 'admin'=any(roles)")).rows[0].n,0);
 await db.exec("select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);set role authenticated");
 await assert.rejects(db.query("select public.save_student(gen_random_uuid(),'Blocked',false,0)"),/Staff access required/);
 }finally{await db.close();}
});
