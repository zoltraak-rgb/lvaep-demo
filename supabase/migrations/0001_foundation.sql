begin;
create schema if not exists app_private;
revoke all on schema app_private from public;

create table public.people (
  id uuid primary key references auth.users(id),
  display_name text not null check (length(trim(display_name)) between 1 and 120),
  roles text[] not null default '{}' check (roles <@ array['tutor','staff','admin']::text[]),
  active boolean not null default true,
  version integer not null default 1,
  created_at timestamptz not null default now()
);
create table public.students (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (length(trim(display_name)) between 1 and 120),
  archived boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null default now()
);
create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid not null references public.people(id),
  student_id uuid not null references public.students(id),
  starts_on date not null check (isfinite(starts_on)),
  ends_on date check (ends_on is null or (isfinite(ends_on) and ends_on >= starts_on)),
  version integer not null default 1,
  unique(tutor_id, student_id, starts_on)
);
create table public.lessons (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid not null references public.people(id),
  lesson_date date not null check (isfinite(lesson_date)),
  minutes integer not null check (minutes > 0),
  request_id uuid not null,
  request_payload jsonb not null,
  version integer not null default 1,
  voided boolean not null default false,
  created_at timestamptz not null default now(),
  unique(tutor_id, request_id)
);
create table public.attendance (
  lesson_id uuid not null references public.lessons(id),
  student_id uuid not null references public.students(id),
  minutes integer not null check (minutes > 0),
  primary key(lesson_id, student_id)
);
create table public.audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid references public.people(id),
  entity text not null,
  entity_id uuid not null,
  action text not null,
  before_value jsonb,
  after_value jsonb,
  created_at timestamptz not null default now()
);
create index on public.assignments(tutor_id, student_id, starts_on, ends_on);
create index on public.lessons(tutor_id, lesson_date);
create index on public.attendance(student_id);

create function app_private.has_role(wanted text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.people where id = auth.uid() and active and wanted = any(roles));
$$;
create function app_private.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select app_private.has_role('staff') or app_private.has_role('admin');
$$;
create function app_private.is_active() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.people where id = auth.uid() and active);
$$;
-- Policies call these helpers without exposing their schema through the API.
grant usage on schema app_private to authenticated;
revoke all on all functions in schema app_private from public;
grant execute on all functions in schema app_private to authenticated;

alter table public.people enable row level security;
alter table public.students enable row level security;
alter table public.assignments enable row level security;
alter table public.lessons enable row level security;
alter table public.attendance enable row level security;
alter table public.audit_events enable row level security;
revoke all on public.people, public.students, public.assignments, public.lessons, public.attendance, public.audit_events from anon, authenticated;
grant select on public.people, public.students, public.assignments, public.lessons, public.attendance, public.audit_events to authenticated;

create policy people_read on public.people for select to authenticated using (
  app_private.is_staff() or (id = auth.uid() and app_private.is_active())
);
create policy assignments_read on public.assignments for select to authenticated using (
  app_private.is_staff() or (tutor_id = auth.uid() and app_private.has_role('tutor'))
);
create policy students_read on public.students for select to authenticated using (
  app_private.is_staff() or (app_private.has_role('tutor') and exists (
    select 1 from public.assignments a where a.student_id = students.id and a.tutor_id = auth.uid()
  ))
);
create policy lessons_read on public.lessons for select to authenticated using (
  app_private.is_staff() or (tutor_id = auth.uid() and app_private.has_role('tutor'))
);
create policy attendance_read on public.attendance for select to authenticated using (
  exists(select 1 from public.lessons l where l.id = attendance.lesson_id)
);
create policy audit_read on public.audit_events for select to authenticated using (app_private.is_staff());

-- No client can assign its own role or provision the first administrator.
-- Bootstrap requires the project owner; subsequent changes require an existing admin.
create function public.set_person_access(p_person uuid, p_roles text[], p_active boolean, p_version integer)
returns public.people language plpgsql security definer set search_path = '' as $$
declare old_row public.people; new_row public.people;
begin
  if not app_private.has_role('admin') then raise exception 'Administrator access required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(681301);
  select * into old_row from public.people where id=p_person for update;
  if not found then raise exception 'Person not found'; end if;
  if p_version is null or old_row.version <> p_version then raise exception 'This record changed. Reload before saving.' using errcode='40001'; end if;
  if p_roles is null or p_active is null or not p_roles <@ array['tutor','staff','admin']::text[] then raise exception 'Invalid access settings'; end if;
  if old_row.active and 'admin'=any(old_row.roles) and (not p_active or not 'admin'=any(p_roles)) and
    not exists(select 1 from public.people where id<>p_person and active and 'admin'=any(roles)) then
    raise exception 'The last administrator must keep access';
  end if;
  update public.people set roles=p_roles, active=p_active, version=version+1 where id=p_person returning * into new_row;
  insert into public.audit_events(actor_id,entity,entity_id,action,before_value,after_value)
    values(auth.uid(),'person',p_person,'access_changed',to_jsonb(old_row),to_jsonb(new_row));
  return new_row;
end;
$$;

create function public.save_student(p_id uuid, p_name text, p_archived boolean, p_version integer)
returns public.students language plpgsql security definer set search_path = '' as $$
declare old_row public.students; new_row public.students;
begin
  if not app_private.is_staff() then raise exception 'Staff access required' using errcode='42501'; end if;
  -- The client supplies a stable UUID so a lost response can be retried safely.
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 0));
  select * into old_row from public.students where id=p_id for update;
  if found then
    if p_version is null or old_row.version <> p_version then
      if old_row.display_name=trim(p_name) and old_row.archived=p_archived then return old_row; end if;
      raise exception 'This record changed. Reload before saving.' using errcode='40001';
    end if;
    update public.students set display_name=trim(p_name), archived=p_archived, version=version+1 where id=p_id returning * into new_row;
  else
    if p_version is null or p_version <> 0 then raise exception 'Student not found'; end if;
    insert into public.students(id,display_name,archived) values(p_id,trim(p_name),p_archived) returning * into new_row;
  end if;
  insert into public.audit_events(actor_id,entity,entity_id,action,before_value,after_value)
    values(auth.uid(),'student',p_id,'saved',case when old_row.id is null then null else to_jsonb(old_row) end,to_jsonb(new_row));
  return new_row;
end;
$$;

create function public.assign_student(p_id uuid,p_tutor uuid,p_student uuid,p_start date)
returns public.assignments language plpgsql security definer set search_path = '' as $$
declare row_value public.assignments;
begin
  if not app_private.is_staff() then raise exception 'Staff access required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_tutor::text,0));
  select * into row_value from public.assignments where id=p_id;
  if found then
    if row_value.tutor_id=p_tutor and row_value.student_id=p_student and row_value.starts_on=p_start then return row_value; end if;
    raise exception 'Assignment retry does not match original request';
  end if;
  if not exists(select 1 from public.people where id=p_tutor and active and 'tutor'=any(roles)) then raise exception 'Choose an active tutor'; end if;
  if not exists(select 1 from public.students where id=p_student and not archived) then raise exception 'Choose an active student'; end if;
  if exists(select 1 from public.assignments where tutor_id=p_tutor and student_id=p_student and (ends_on is null or ends_on>=p_start)) then raise exception 'This tutor already has an overlapping assignment'; end if;
  insert into public.assignments(id,tutor_id,student_id,starts_on) values(p_id,p_tutor,p_student,p_start) returning * into row_value;
  insert into public.audit_events(actor_id,entity,entity_id,action,after_value) values(auth.uid(),'assignment',p_id,'created',to_jsonb(row_value));
  return row_value;
end;
$$;

create function public.record_lesson(p_request uuid,p_date date,p_minutes integer,p_participants jsonb,p_allow_additional boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare canonical jsonb; existing public.lessons; new_id uuid; conflicts jsonb; entry record;
begin
  if not app_private.has_role('tutor') then raise exception 'Tutor access required' using errcode='42501'; end if;
  if p_request is null or p_date is null or not isfinite(p_date) or p_minutes is null or p_minutes<=0 then raise exception 'Enter a date and positive whole minutes'; end if;
  if p_participants is null or jsonb_typeof(p_participants)<>'array' or jsonb_array_length(p_participants)=0 then raise exception 'Choose at least one student'; end if;
  select jsonb_agg(jsonb_build_object('student_id',x.student_id,'minutes',x.minutes) order by x.student_id) into canonical
    from jsonb_to_recordset(p_participants) as x(student_id uuid,minutes integer);
  if exists(select 1 from jsonb_to_recordset(canonical) as x(student_id uuid,minutes integer) where student_id is null or minutes is null or minutes<=0 or minutes>p_minutes) then raise exception 'Attendance must be positive and cannot exceed lesson duration'; end if;
  if (select count(*)<>count(distinct student_id) from jsonb_to_recordset(canonical) as x(student_id uuid,minutes integer)) then raise exception 'A student can appear only once in a lesson'; end if;
  canonical := jsonb_build_object('date',p_date,'minutes',p_minutes,'participants',canonical);
  -- Serializes concurrent duplicate taps and same-day conflict checks for this tutor.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
  select * into existing from public.lessons where tutor_id=auth.uid() and request_id=p_request;
  if found then
    if existing.request_payload<>canonical then raise exception 'Retry contents changed. Reload the saved lesson.'; end if;
    return jsonb_build_object('status','saved','lesson_id',existing.id,'replayed',true);
  end if;
  for entry in select * from jsonb_to_recordset(p_participants) as x(student_id uuid,minutes integer) loop
    if not exists(select 1 from public.assignments a where a.tutor_id=auth.uid() and a.student_id=entry.student_id and a.starts_on<=p_date and (a.ends_on is null or a.ends_on>=p_date)) then
      raise exception 'A selected student is not assigned to you on this date' using errcode='42501';
    end if;
  end loop;
  select jsonb_agg(jsonb_build_object('id',l.id,'date',l.lesson_date,'minutes',l.minutes) order by l.created_at) into conflicts
    from public.lessons l where l.tutor_id=auth.uid() and l.lesson_date=p_date and not l.voided and exists(
      select 1 from public.attendance a where a.lesson_id=l.id and a.student_id in (
        select student_id from jsonb_to_recordset(p_participants) as x(student_id uuid,minutes integer)
      )
    );
  if conflicts is not null and not coalesce(p_allow_additional,false) then return jsonb_build_object('status','duplicate_warning','existing',conflicts); end if;
  insert into public.lessons(tutor_id,lesson_date,minutes,request_id,request_payload)
    values(auth.uid(),p_date,p_minutes,p_request,canonical) returning id into new_id;
  insert into public.attendance(lesson_id,student_id,minutes)
    select new_id,student_id,minutes from jsonb_to_recordset(p_participants) as x(student_id uuid,minutes integer);
  insert into public.audit_events(actor_id,entity,entity_id,action,after_value)
    values(auth.uid(),'lesson',new_id,'recorded',canonical);
  return jsonb_build_object('status','saved','lesson_id',new_id,'replayed',false);
end;
$$;
revoke all on function public.set_person_access(uuid,text[],boolean,integer), public.save_student(uuid,text,boolean,integer), public.assign_student(uuid,uuid,uuid,date), public.record_lesson(uuid,date,integer,jsonb,boolean) from public, anon;
grant execute on function public.set_person_access(uuid,text[],boolean,integer), public.save_student(uuid,text,boolean,integer), public.assign_student(uuid,uuid,uuid,date), public.record_lesson(uuid,date,integer,jsonb,boolean) to authenticated;
commit;
