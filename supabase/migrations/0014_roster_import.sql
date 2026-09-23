begin;
create table public.roster_references(
 kind text not null check(kind in ('student','tutor')),
 reference text not null check(reference ~ '^[A-Za-z0-9_-]{1,80}$'),
 person_id uuid references public.people(id),
 student_id uuid references public.students(id),
 primary key(kind,reference),
 unique(student_id),unique(person_id),
 check((kind='student' and student_id is not null and person_id is null) or (kind='tutor' and person_id is not null and student_id is null))
);
create table public.roster_imports(id uuid primary key,actor_id uuid not null references public.people(id),payload jsonb not null,result jsonb not null,created_at timestamptz not null default now());
alter table public.roster_references enable row level security;
alter table public.roster_imports enable row level security;
revoke all on public.roster_references,public.roster_imports from public,anon,authenticated;
grant select on public.roster_references,public.roster_imports to authenticated;
create policy reference_staff_read on public.roster_references for select to authenticated using(app_private.is_staff());
create policy import_staff_read on public.roster_imports for select to authenticated using(app_private.is_staff());
-- Stable staff-only references for existing and subsequently created records.
create function app_private.make_roster_reference() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='students' then
  insert into public.roster_references(kind,reference,student_id) values('student','STUDENT-'||new.id::text,new.id) on conflict do nothing;
 elsif 'tutor'=any(new.roles) then
  insert into public.roster_references(kind,reference,person_id) values('tutor','TUTOR-'||new.id::text,new.id) on conflict do nothing;
 end if;
 return new;
end;
$$;
revoke all on function app_private.make_roster_reference() from public,anon,authenticated;
create trigger student_import_reference after insert on public.students for each row execute function app_private.make_roster_reference();
create trigger tutor_import_reference after insert or update of roles on public.people for each row execute function app_private.make_roster_reference();
insert into public.roster_references(kind,reference,student_id) select 'student','STUDENT-'||id::text,id from public.students;
insert into public.roster_references(kind,reference,person_id) select 'tutor','TUTOR-'||id::text,id from public.people where 'tutor'=any(roles);
create function public.import_roster(p_id uuid,p_rows jsonb,p_commit boolean default false,p_expected jsonb default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare prior public.roster_imports; row_value jsonb; actions jsonb='[]'; action jsonb; sid uuid; tid uuid; aid uuid; start_date date; v_reference text; student_name text; result jsonb; existing_student public.students;
begin
 if not app_private.is_staff() then raise exception 'Staff access required' using errcode='42501'; end if;
 if p_id is null or p_commit is null or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 500 then raise exception 'Import requires 1–500 rows'; end if;
 perform pg_advisory_xact_lock(681314);
 select * into prior from public.roster_imports where id=p_id;
 if found then
  if prior.actor_id<>auth.uid() or prior.payload<>p_rows then raise exception 'Import retry does not match'; end if;
  return prior.result;
 end if;
 -- Lock referenced tutors in a stable order before checking assignment overlap.
 for tid in select distinct r.person_id from jsonb_array_elements(p_rows) v join public.roster_references r on r.kind='tutor' and r.reference=v->>'tutor_ref' order by r.person_id loop
  perform pg_advisory_xact_lock(hashtextextended(tid::text,0));
 end loop;
 if exists(select 1 from jsonb_array_elements(p_rows) v group by v->>'student_ref',v->>'tutor_ref',v->>'starts_on' having count(*)>1) then raise exception 'Repeated student/assignment row'; end if;
 if exists(select 1 from jsonb_array_elements(p_rows) v group by v->>'student_ref' having count(distinct v->>'student_name')>1) then raise exception 'Same reference has different names'; end if;
 for row_value in select value from jsonb_array_elements(p_rows) loop
  v_reference=row_value->>'student_ref';student_name=row_value->>'student_name';sid=null;tid=null;aid=null;start_date=null;
  if v_reference is null or v_reference !~ '^[A-Za-z0-9_-]{1,80}$' or student_name is null or length(trim(student_name)) not between 1 and 120 or student_name<>trim(student_name) then raise exception 'Invalid student reference or name'; end if;
  select r.student_id into sid from public.roster_references r where r.kind='student' and r.reference=v_reference;
  if sid is not null then
   perform pg_advisory_xact_lock(hashtextextended(sid::text,0));
   select * into existing_student from public.students where id=sid for update;
   if existing_student.archived then raise exception 'Student % is archived; restore through their profile first',v_reference; end if;
   if existing_student.display_name<>student_name then raise exception 'Reference % has another saved name; check identity or edit the profile first',v_reference; end if;
  end if;
  if coalesce(row_value->>'tutor_ref','')<>'' then
   select r.person_id into tid from public.roster_references r join public.people p on p.id=r.person_id where r.kind='tutor' and r.reference=row_value->>'tutor_ref' and p.active and 'tutor'=any(p.roles);
   if tid is null then raise exception 'Unknown or inactive tutor reference'; end if;
   if coalesce(row_value->>'starts_on','') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Use assignment date YYYY-MM-DD'; end if;
   start_date=(row_value->>'starts_on')::date;
   if not isfinite(start_date) then raise exception 'Invalid assignment date'; end if;
   select id into aid from public.assignments where tutor_id=tid and student_id=sid and starts_on=start_date;
   if aid is null and exists(select 1 from public.assignments where tutor_id=tid and student_id=sid and (ends_on is null or ends_on>=start_date)) then raise exception 'Overlapping assignment for %',v_reference; end if;
   if exists(select 1 from jsonb_array_elements(actions) a where a->>'student_ref'=v_reference and a->>'tutor_ref'=row_value->>'tutor_ref') then raise exception 'Multiple assignments for the same tutor/student in this file'; end if;
  elsif coalesce(row_value->>'starts_on','')<>'' then raise exception 'A date needs a tutor v_reference';
  end if;
  action=jsonb_build_object('student_ref',v_reference,'student_name',student_name,'student_id',sid,'tutor_ref',coalesce(row_value->>'tutor_ref',''),'tutor_id',tid,'starts_on',start_date,'assignment_id',aid,'student_action',case when sid is null then 'Create student' else 'Use existing student' end,'assignment_action',case when tid is null then 'No assignment' when aid is not null then 'Already assigned' else 'Create assignment' end,'same_name_warning',sid is null and (exists(select 1 from public.students where lower(display_name)=lower(student_name)) or exists(select 1 from jsonb_array_elements(p_rows) v where v->>'student_ref'<>v_reference and lower(v->>'student_name')=lower(student_name))));
  actions=actions||jsonb_build_array(action);
 end loop;
 if not p_commit then return jsonb_build_object('status','preview','actions',actions); end if;
 if p_expected is distinct from actions then raise exception 'Roster changed since preview. Preview again before importing.' using errcode='40001'; end if;
 for action in select value from jsonb_array_elements(actions) loop
  select r.student_id into sid from public.roster_references r where r.kind='student' and r.reference=action->>'student_ref';
  if sid is null then
   sid=gen_random_uuid();perform public.save_student(sid,action->>'student_name',false,0);
   update public.roster_references set reference=action->>'student_ref' where student_id=sid;
  end if;
  tid=(action->>'tutor_id')::uuid;
  if tid is not null and action->>'assignment_id' is null then perform public.assign_student(gen_random_uuid(),tid,sid,(action->>'starts_on')::date); end if;
 end loop;
 result=jsonb_build_object('status','imported','row_count',jsonb_array_length(p_rows));
 insert into public.roster_imports(id,actor_id,payload,result) values(p_id,auth.uid(),p_rows,result);
 insert into public.audit_events(actor_id,entity,entity_id,action,after_value) values(auth.uid(),'roster_import',p_id,'imported',result);
 return result;
end;
$$;
revoke all on function public.import_roster(uuid,jsonb,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.import_roster(uuid,jsonb,boolean,jsonb) to authenticated;
commit;
