begin;
create function public.correct_lesson(p_id uuid,p_version integer,p_date date,p_minutes integer,p_participants jsonb,p_void boolean,p_allow_additional boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare old_row public.lessons; canonical jsonb; old_attendance jsonb; conflicts jsonb; entry record;
begin
 select * into old_row from public.lessons where id=p_id;
 if not found or not (app_private.is_staff() or (old_row.tutor_id=auth.uid() and app_private.has_role('tutor'))) then raise exception 'Lesson unavailable' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(old_row.tutor_id::text,0));
 select * into old_row from public.lessons where id=p_id for update;
 if p_version is null or p_void is null or p_date is null or not isfinite(p_date) or p_minutes is null or p_minutes<=0 then raise exception 'Invalid correction'; end if;
 if p_participants is null or jsonb_typeof(p_participants)<>'array' or jsonb_array_length(p_participants)=0 then raise exception 'Choose students'; end if;
 select jsonb_agg(jsonb_build_object('student_id',x.student_id,'minutes',x.minutes) order by x.student_id) into canonical from jsonb_to_recordset(p_participants) x(student_id uuid,minutes integer);
 if exists(select 1 from jsonb_to_recordset(canonical) x(student_id uuid,minutes integer) where student_id is null or minutes is null or minutes<=0 or minutes>p_minutes) then raise exception 'Invalid attendance duration'; end if;
 if (select count(*)<>count(distinct student_id) from jsonb_to_recordset(canonical) x(student_id uuid,minutes integer)) then raise exception 'Duplicate participant'; end if;
 select jsonb_agg(jsonb_build_object('student_id',a.student_id,'minutes',a.minutes) order by a.student_id) into old_attendance from public.attendance a where a.lesson_id=p_id;
 if old_row.lesson_date=p_date and old_row.minutes=p_minutes and old_attendance=canonical and old_row.voided=p_void and old_row.version in (p_version,p_version+1) then return jsonb_build_object('status','saved','replayed',true); end if;
 if old_row.version<>p_version then raise exception 'Lesson changed. Reload before editing' using errcode='40001'; end if;
 if old_row.voided then raise exception 'This lesson is already voided'; end if;
 -- Voiding retains the original record verbatim, except its state/version.
 if p_void and (old_row.lesson_date<>p_date or old_row.minutes<>p_minutes or old_attendance<>canonical) then raise exception 'Void the original lesson without other changes'; end if;
 if not p_void then
   for entry in select * from jsonb_to_recordset(canonical) x(student_id uuid,minutes integer) loop
     if not exists(select 1 from public.assignments a where a.tutor_id=old_row.tutor_id and a.student_id=entry.student_id and a.starts_on<=p_date and (a.ends_on is null or a.ends_on>=p_date)) then raise exception 'Student not assigned on corrected date'; end if;
   end loop;
   select jsonb_agg(jsonb_build_object('id',l.id,'date',l.lesson_date,'minutes',l.minutes)) into conflicts from public.lessons l
   where l.id<>p_id and l.tutor_id=old_row.tutor_id and l.lesson_date=p_date and not l.voided and exists(select 1 from public.attendance a where a.lesson_id=l.id and a.student_id in(select x.student_id from jsonb_to_recordset(canonical) x(student_id uuid,minutes integer)));
   if conflicts is not null and not coalesce(p_allow_additional,false) then return jsonb_build_object('status','duplicate_warning','existing',conflicts); end if;
 end if;
 update public.lessons set lesson_date=p_date,minutes=p_minutes,voided=p_void,version=version+1 where id=p_id;
 delete from public.attendance where lesson_id=p_id;
 insert into public.attendance(lesson_id,student_id,minutes) select p_id,x.student_id,x.minutes from jsonb_to_recordset(canonical) x(student_id uuid,minutes integer);
 insert into public.audit_events(actor_id,entity,entity_id,action,before_value,after_value)
 values(auth.uid(),'lesson',p_id,case when p_void then 'voided' else 'corrected' end,
 jsonb_build_object('date',old_row.lesson_date,'minutes',old_row.minutes,'participants',old_attendance,'version',old_row.version,'voided',old_row.voided),
 jsonb_build_object('date',p_date,'minutes',p_minutes,'participants',canonical,'version',old_row.version+1,'voided',p_void));
 return jsonb_build_object('status','saved','replayed',false);
end;
$$;
revoke all on function public.correct_lesson(uuid,integer,date,integer,jsonb,boolean,boolean) from public,anon,authenticated;
grant execute on function public.correct_lesson(uuid,integer,date,integer,jsonb,boolean,boolean) to authenticated;
commit;
