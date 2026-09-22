begin;
create function public.correct_mixed_lesson(p_id uuid,p_version integer,p_date date,p_minutes integer,p_participants jsonb,p_void boolean,p_pending jsonb,p_allow_additional boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare old_row public.lessons; canonical jsonb; old_attendance jsonb; conflicts jsonb; entry record; pending_canonical jsonb; old_pending jsonb;
begin
 select * into old_row from public.lessons where id=p_id;
 if not found or not (app_private.is_staff() or (old_row.tutor_id=auth.uid() and app_private.has_role('tutor'))) then raise exception 'Lesson unavailable' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(old_row.tutor_id::text,0));
 select * into old_row from public.lessons where id=p_id for update;
 if p_version is null or p_void is null or p_date is null or not isfinite(p_date) or p_minutes is null or p_minutes<=0 then raise exception 'Invalid correction'; end if;
 if p_participants is null or jsonb_typeof(p_participants)<>'array' then raise exception 'Choose students'; end if;
 if p_pending is null or jsonb_typeof(p_pending)<>'array' then raise exception 'Invalid pending attendance'; end if;
 if jsonb_array_length(p_participants)+jsonb_array_length(p_pending)=0 then raise exception 'Choose students'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('request_id',x.request_id,'minutes',x.minutes) order by x.request_id),'[]'::jsonb) into pending_canonical from jsonb_to_recordset(p_pending) x(request_id uuid,minutes integer);
 if exists(select 1 from jsonb_to_recordset(pending_canonical) x(request_id uuid,minutes integer) where request_id is null or minutes is null or minutes<=0 or minutes>p_minutes) then raise exception 'Invalid pending attendance duration'; end if;
 if (select count(*)<>count(distinct request_id) from jsonb_to_recordset(pending_canonical) x(request_id uuid,minutes integer)) then raise exception 'Duplicate pending participant'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('request_id',a.request_id,'minutes',a.minutes) order by a.request_id),'[]'::jsonb) into old_pending from public.pending_attendance a where a.lesson_id=p_id;
 select jsonb_agg(jsonb_build_object('student_id',x.student_id,'minutes',x.minutes) order by x.student_id) into canonical from jsonb_to_recordset(p_participants) x(student_id uuid,minutes integer);
 canonical=coalesce(canonical,'[]'::jsonb);
 if exists(select 1 from jsonb_to_recordset(canonical) x(student_id uuid,minutes integer) where student_id is null or minutes is null or minutes<=0 or minutes>p_minutes) then raise exception 'Invalid attendance duration'; end if;
 if (select count(*)<>count(distinct student_id) from jsonb_to_recordset(canonical) x(student_id uuid,minutes integer)) then raise exception 'Duplicate participant'; end if;
 select jsonb_agg(jsonb_build_object('student_id',a.student_id,'minutes',a.minutes) order by a.student_id) into old_attendance from public.attendance a where a.lesson_id=p_id;
 old_attendance=coalesce(old_attendance,'[]'::jsonb);
 if old_row.lesson_date=p_date and old_row.minutes=p_minutes and old_attendance=canonical and old_pending=pending_canonical and old_row.voided=p_void and old_row.version in (p_version,p_version+1) then return jsonb_build_object('status','saved','replayed',true); end if;
 if old_row.version<>p_version then raise exception 'Lesson changed. Reload before editing' using errcode='40001'; end if;
 if old_row.voided then raise exception 'This lesson is already voided'; end if;
 -- Voiding retains the original record verbatim, except its state/version.
 if p_void and (old_row.lesson_date<>p_date or old_row.minutes<>p_minutes or old_attendance<>canonical or old_pending<>pending_canonical) then raise exception 'Void the original lesson without other changes'; end if;
 if not p_void then
   for entry in select * from jsonb_to_recordset(pending_canonical) x(request_id uuid,minutes integer) loop
     if not exists(select 1 from public.student_requests r where r.id=entry.request_id and r.tutor_id=old_row.tutor_id and r.status='pending') then raise exception 'Pending request unavailable' using errcode='42501'; end if;
   end loop;
   for entry in select * from jsonb_to_recordset(canonical) x(student_id uuid,minutes integer) loop
     if not exists(select 1 from public.assignments a where a.tutor_id=old_row.tutor_id and a.student_id=entry.student_id and a.starts_on<=p_date and (a.ends_on is null or a.ends_on>=p_date)) then raise exception 'Student not assigned on corrected date'; end if;
   end loop;
   select jsonb_agg(jsonb_build_object('id',l.id,'date',l.lesson_date,'minutes',l.minutes)) into conflicts from public.lessons l
   where l.id<>p_id and l.tutor_id=old_row.tutor_id and l.lesson_date=p_date and not l.voided and (exists(select 1 from public.attendance a where a.lesson_id=l.id and a.student_id in(select x.student_id from jsonb_to_recordset(canonical) x(student_id uuid,minutes integer))) or exists(select 1 from public.pending_attendance a where a.lesson_id=l.id and a.request_id in(select x.request_id from jsonb_to_recordset(pending_canonical) x(request_id uuid,minutes integer))));
   if conflicts is not null and not coalesce(p_allow_additional,false) then return jsonb_build_object('status','duplicate_warning','existing',conflicts); end if;
 end if;
 update public.lessons set lesson_date=p_date,minutes=p_minutes,voided=p_void,version=version+1 where id=p_id;
 delete from public.attendance where lesson_id=p_id;
 insert into public.attendance(lesson_id,student_id,minutes) select p_id,x.student_id,x.minutes from jsonb_to_recordset(canonical) x(student_id uuid,minutes integer);
 delete from public.pending_attendance where lesson_id=p_id;
 insert into public.pending_attendance(lesson_id,request_id,minutes) select p_id,x.request_id,x.minutes from jsonb_to_recordset(pending_canonical) x(request_id uuid,minutes integer);
 insert into public.audit_events(actor_id,entity,entity_id,action,before_value,after_value)
 values(auth.uid(),'lesson',p_id,case when p_void then 'voided' else 'corrected' end,
 jsonb_build_object('date',old_row.lesson_date,'minutes',old_row.minutes,'participants',old_attendance,'pending',old_pending,'version',old_row.version,'voided',old_row.voided),
 jsonb_build_object('date',p_date,'minutes',p_minutes,'participants',canonical,'pending',pending_canonical,'version',old_row.version+1,'voided',p_void));
 return jsonb_build_object('status','saved','replayed',false);
end;
$$;
revoke all on function public.correct_mixed_lesson(uuid,integer,date,integer,jsonb,boolean,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.correct_mixed_lesson(uuid,integer,date,integer,jsonb,boolean,jsonb,boolean) to authenticated;
-- Keep the existing endpoint safe for older clients: preserve pending rows, never silently drop them.
create or replace function public.correct_lesson(p_id uuid,p_version integer,p_date date,p_minutes integer,p_participants jsonb,p_void boolean,p_allow_additional boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid; pending jsonb;
begin
 select tutor_id into owner_id from public.lessons where id=p_id;
 if owner_id is null or not (app_private.is_staff() or (owner_id=auth.uid() and app_private.has_role('tutor'))) then raise exception 'Lesson unavailable' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(owner_id::text,0));
 select coalesce(jsonb_agg(jsonb_build_object('request_id',request_id,'minutes',minutes) order by request_id),'[]'::jsonb) into pending from public.pending_attendance where lesson_id=p_id;
 return public.correct_mixed_lesson(p_id,p_version,p_date,p_minutes,p_participants,p_void,pending,p_allow_additional);
end;
$$;
create function public.record_mixed_planned_lesson(p_occurrence uuid,p_plan_version integer,p_request uuid,p_date date,p_minutes integer,p_participants jsonb,p_pending jsonb,p_allow_additional boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare occurrence public.planned_occurrences; plan public.lesson_plans; result jsonb;
begin
 if not app_private.has_role('tutor') then raise exception 'Tutor access required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 select o.* into occurrence from public.planned_occurrences o join public.lesson_plans p on p.id=o.plan_id where o.id=p_occurrence and p.tutor_id=auth.uid();
 if not found then raise exception 'Plan unavailable' using errcode='42501'; end if;
 select * into plan from public.lesson_plans where id=occurrence.plan_id;
 if occurrence.lesson_id is not null then
   if not exists(select 1 from public.lessons where id=occurrence.lesson_id and request_id=p_request and tutor_id=auth.uid()) then raise exception 'This plan already has a saved lesson. Open the recorded lesson to correct it.'; end if;
   return public.record_mixed_lesson(p_request,p_date,p_minutes,p_participants,p_pending,p_allow_additional);
 end if;
 if occurrence.canceled then raise exception 'This plan is canceled'; end if;
 if p_plan_version is null or plan.version<>p_plan_version then raise exception 'Plan changed. Reload before recording attendance'; end if;
 -- Request identities cannot attach an existing unrelated lesson to this occurrence.
 if exists(select 1 from public.lessons where tutor_id=auth.uid() and request_id=p_request) then raise exception 'Request already used for another lesson'; end if;
 result=public.record_mixed_lesson(p_request,p_date,p_minutes,p_participants,p_pending,p_allow_additional);
 if result->>'status'='saved' then
   update public.planned_occurrences set lesson_id=(result->>'lesson_id')::uuid where id=p_occurrence;
   insert into public.audit_events(actor_id,entity,entity_id,action,before_value,after_value)
   values(auth.uid(),'planned_occurrence',p_occurrence,'attendance_recorded',to_jsonb(occurrence),jsonb_build_object('lesson_id',result->>'lesson_id'));
 end if;
 return result;
end;
$$;
revoke all on function public.record_mixed_planned_lesson(uuid,integer,uuid,date,integer,jsonb,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.record_mixed_planned_lesson(uuid,integer,uuid,date,integer,jsonb,jsonb,boolean) to authenticated;
commit;
