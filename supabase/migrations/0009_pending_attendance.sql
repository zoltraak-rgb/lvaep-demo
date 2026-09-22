begin;
create table public.pending_attendance (
 lesson_id uuid not null references public.lessons(id),
 request_id uuid not null references public.student_requests(id),
 minutes integer not null check(minutes>0),
 primary key(lesson_id,request_id)
);
alter table public.pending_attendance enable row level security;
revoke all on public.pending_attendance from public,anon,authenticated;
grant select on public.pending_attendance to authenticated;
create policy pending_attendance_read on public.pending_attendance for select to authenticated using(
 app_private.is_staff() or exists(select 1 from public.lessons l where l.id=lesson_id and l.tutor_id=auth.uid() and app_private.has_role('tutor'))
);
create function public.record_mixed_lesson(p_request uuid,p_date date,p_minutes integer,p_participants jsonb,p_pending jsonb,p_allow_additional boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare canonical jsonb; existing public.lessons; new_id uuid; conflicts jsonb; entry record; pending_canonical jsonb;
begin
  if not app_private.has_role('tutor') then raise exception 'Tutor access required' using errcode='42501'; end if;
  if p_request is null or p_date is null or not isfinite(p_date) or p_minutes is null or p_minutes<=0 then raise exception 'Enter a date and positive whole minutes'; end if;
  if p_participants is null or jsonb_typeof(p_participants)<>'array'  then raise exception 'Choose at least one student'; end if;
  if p_pending is null or jsonb_typeof(p_pending)<>'array' or jsonb_array_length(p_participants)+jsonb_array_length(p_pending)=0 then raise exception 'Choose at least one participant'; end if;
  select jsonb_agg(jsonb_build_object('request_id',x.request_id,'minutes',x.minutes) order by x.request_id) into pending_canonical from jsonb_to_recordset(p_pending) x(request_id uuid,minutes integer);
  if exists(select 1 from jsonb_to_recordset(p_pending) x(request_id uuid,minutes integer) where request_id is null or minutes is null or minutes<=0 or minutes>p_minutes) then raise exception 'Invalid pending attendance duration'; end if;
  if (select count(*)<>count(distinct request_id) from jsonb_to_recordset(p_pending) x(request_id uuid,minutes integer)) then raise exception 'Duplicate pending participant'; end if;
  select jsonb_agg(jsonb_build_object('student_id',x.student_id,'minutes',x.minutes) order by x.student_id) into canonical
    from jsonb_to_recordset(p_participants) as x(student_id uuid,minutes integer);
  if exists(select 1 from jsonb_to_recordset(canonical) as x(student_id uuid,minutes integer) where student_id is null or minutes is null or minutes<=0 or minutes>p_minutes) then raise exception 'Attendance must be positive and cannot exceed lesson duration'; end if;
  if (select count(*)<>count(distinct student_id) from jsonb_to_recordset(canonical) as x(student_id uuid,minutes integer)) then raise exception 'A student can appear only once in a lesson'; end if;
  canonical := jsonb_build_object('date',p_date,'minutes',p_minutes,'participants',coalesce(canonical,'[]'::jsonb),'pending',coalesce(pending_canonical,'[]'::jsonb));
  -- Serializes concurrent duplicate taps and same-day conflict checks for this tutor.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
  select * into existing from public.lessons where tutor_id=auth.uid() and request_id=p_request;
  if found then
    if existing.request_payload<>canonical then raise exception 'Retry contents changed. Reload the saved lesson.'; end if;
    return jsonb_build_object('status','saved','lesson_id',existing.id,'replayed',true);
  end if;
  for entry in select * from jsonb_to_recordset(p_pending) x(request_id uuid,minutes integer) loop
    if not exists(select 1 from public.student_requests r where r.id=entry.request_id and r.tutor_id=auth.uid() and r.status='pending') then raise exception 'Pending request unavailable' using errcode='42501'; end if;
  end loop;
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
    ) or (l.tutor_id=auth.uid() and l.lesson_date=p_date and not l.voided and exists(select 1 from public.pending_attendance pa where pa.lesson_id=l.id and pa.request_id in(select request_id from jsonb_to_recordset(p_pending) x(request_id uuid,minutes integer))));
  if conflicts is not null and not coalesce(p_allow_additional,false) then return jsonb_build_object('status','duplicate_warning','existing',conflicts); end if;
  insert into public.lessons(tutor_id,lesson_date,minutes,request_id,request_payload)
    values(auth.uid(),p_date,p_minutes,p_request,canonical) returning id into new_id;
  insert into public.attendance(lesson_id,student_id,minutes)
    select new_id,student_id,minutes from jsonb_to_recordset(p_participants) as x(student_id uuid,minutes integer);
  insert into public.pending_attendance(lesson_id,request_id,minutes) select new_id,request_id,minutes from jsonb_to_recordset(p_pending) x(request_id uuid,minutes integer);
  insert into public.audit_events(actor_id,entity,entity_id,action,after_value)
    values(auth.uid(),'lesson',new_id,'recorded',canonical);
  return jsonb_build_object('status','saved','lesson_id',new_id,'replayed',false);
end;
$$;
revoke all on function public.record_mixed_lesson(uuid,date,integer,jsonb,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.record_mixed_lesson(uuid,date,integer,jsonb,jsonb,boolean) to authenticated;
-- Preserve existing confirmations when adding the empty pending collection to the snapshot format.
update public.monthly_reviews r set reviewed_snapshot=jsonb_set(r.reviewed_snapshot,'{lessons}',
 coalesce((select jsonb_agg(l || jsonb_build_object('pending',coalesce(l->'pending','[]'::jsonb)) order by l->>'date',l->>'id') from jsonb_array_elements(r.reviewed_snapshot->'lessons') l),'[]'::jsonb));
create or replace function app_private.review_snapshot(p_tutor uuid,p_month date) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'students',coalesce((select jsonb_agg(s.student_id order by s.student_id) from (
      select a.student_id from public.assignments a where a.tutor_id=p_tutor and a.starts_on < p_month+interval '1 month' and (a.ends_on is null or a.ends_on>=p_month)
      union select a.student_id from public.attendance a join public.lessons l on l.id=a.lesson_id where l.tutor_id=p_tutor and not l.voided and l.lesson_date>=p_month and l.lesson_date<p_month+interval '1 month'
    ) s),'[]'::jsonb),
    'lessons',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'date',l.lesson_date,'minutes',l.minutes,'version',l.version,
      'pending',coalesce((select jsonb_agg(jsonb_build_object('request_id',pa.request_id,'minutes',pa.minutes) order by pa.request_id) from public.pending_attendance pa where pa.lesson_id=l.id),'[]'::jsonb),
      'attendance',coalesce((select jsonb_agg(jsonb_build_object('student_id',a.student_id,'minutes',a.minutes) order by a.student_id) from public.attendance a where a.lesson_id=l.id),'[]'::jsonb)) order by l.lesson_date,l.id)
      from public.lessons l where l.tutor_id=p_tutor and not l.voided and l.lesson_date>=p_month and l.lesson_date<p_month+interval '1 month'),'[]'::jsonb)
  );
$$;
create function public.resolve_student_request(p_request uuid,p_student uuid,p_version integer)
returns public.student_requests language plpgsql security definer set search_path='' as $$
declare request public.student_requests; old_review public.monthly_reviews; snapshot jsonb; transformed jsonb; entry jsonb; linked jsonb; new_students jsonb;
begin
 if not app_private.is_staff() then raise exception 'Staff access required' using errcode='42501'; end if;
 select * into request from public.student_requests where id=p_request;
 if not found then raise exception 'Request unavailable'; end if;
 perform pg_advisory_xact_lock(hashtextextended(request.tutor_id::text,0));
 select * into request from public.student_requests where id=p_request for update;
 if request.status='resolved' and request.student_id=p_student then return request; end if;
 if request.status<>'pending' or request.version<>p_version or p_version is null then raise exception 'Request changed. Reload before connecting'; end if;
 if not exists(select 1 from public.students where id=p_student) then raise exception 'Choose an existing student'; end if;
 if exists(select 1 from public.pending_attendance pa join public.lessons l on l.id=pa.lesson_id where pa.request_id=p_request and not exists(select 1 from public.assignments a where a.tutor_id=request.tutor_id and a.student_id=p_student and a.starts_on<=l.lesson_date and (a.ends_on is null or a.ends_on>=l.lesson_date))) then raise exception 'Assign this student for all original lesson dates before connecting'; end if;
 if exists(select 1 from public.pending_attendance pa join public.attendance a on a.lesson_id=pa.lesson_id and a.student_id=p_student where pa.request_id=p_request) then raise exception 'This student already attended a linked lesson. Review the duplicate before connecting'; end if;
 -- Transform only the records actually present in each old reviewed snapshot.
 for old_review in select * from public.monthly_reviews where tutor_id=request.tutor_id for update loop
  snapshot=old_review.reviewed_snapshot;transformed='[]'::jsonb;
  if not exists(select 1 from jsonb_array_elements(snapshot->'lessons') l,jsonb_array_elements(coalesce(l->'pending','[]'::jsonb)) pa where pa->>'request_id'=p_request::text) then continue; end if;
  for entry in select * from jsonb_array_elements(snapshot->'lessons') loop
   select pa into linked from jsonb_array_elements(coalesce(entry->'pending','[]'::jsonb)) pa where pa->>'request_id'=p_request::text;
   if linked is not null then
    entry=jsonb_set(entry,'{version}',to_jsonb((entry->>'version')::integer+1));
    entry=jsonb_set(entry,'{attendance}',(select jsonb_agg(a order by a->>'student_id') from jsonb_array_elements((entry->'attendance')||jsonb_build_array(jsonb_build_object('student_id',p_student,'minutes',linked->'minutes'))) a));
    entry=jsonb_set(entry,'{pending}',coalesce((select jsonb_agg(a order by a->>'request_id') from jsonb_array_elements(entry->'pending') a where a->>'request_id'<>p_request::text),'[]'::jsonb));
   end if;
   transformed=transformed||jsonb_build_array(entry);
  end loop;
  select jsonb_agg(id order by id) into new_students from (select distinct value as id from jsonb_array_elements_text((snapshot->'students')||jsonb_build_array(p_student))) names;
  snapshot=jsonb_set(jsonb_set(snapshot,'{lessons}',transformed),'{students}',new_students);
  update public.monthly_reviews set reviewed_snapshot=snapshot where tutor_id=request.tutor_id and month=old_review.month;
  insert into public.audit_events(actor_id,entity,entity_id,action,before_value,after_value) values(auth.uid(),'monthly_review',request.tutor_id,'pending_identity_connected',to_jsonb(old_review),jsonb_build_object('month',old_review.month,'reviewed_snapshot',snapshot,'confirmed_at',old_review.confirmed_at));
 end loop;
 -- Invalidate already-open correction forms without invalidating an unchanged reviewed snapshot.
 update public.lessons set version=version+1 where id in(select lesson_id from public.pending_attendance where request_id=p_request);
 insert into public.attendance(lesson_id,student_id,minutes) select lesson_id,p_student,minutes from public.pending_attendance where request_id=p_request;
 -- Original pending values remain in the resolution audit; official attendance stays on the same lesson.
 insert into public.audit_events(actor_id,entity,entity_id,action,before_value,after_value) values(auth.uid(),'student_request',p_request,'resolved',jsonb_build_object('request',to_jsonb(request),'attendance',(select jsonb_agg(to_jsonb(pa)) from public.pending_attendance pa where request_id=p_request)),jsonb_build_object('student_id',p_student));
 delete from public.pending_attendance where request_id=p_request;
 update public.student_requests set status='resolved',student_id=p_student,version=version+1 where id=p_request returning * into request;
 return request;
end;
$$;
revoke all on function public.resolve_student_request(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.resolve_student_request(uuid,uuid,integer) to authenticated;
commit;
