begin;
alter table public.planned_occurrences add column lesson_id uuid unique references public.lessons(id);
create function public.record_planned_lesson(p_occurrence uuid,p_plan_version integer,p_request uuid,p_date date,p_minutes integer,p_participants jsonb,p_allow_additional boolean default false)
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
   return public.record_lesson(p_request,p_date,p_minutes,p_participants,p_allow_additional);
 end if;
 if occurrence.canceled then raise exception 'This plan is canceled'; end if;
 if p_plan_version is null or plan.version<>p_plan_version then raise exception 'Plan changed. Reload before recording attendance'; end if;
 -- Request identities cannot attach an existing unrelated lesson to this occurrence.
 if exists(select 1 from public.lessons where tutor_id=auth.uid() and request_id=p_request) then raise exception 'Request already used for another lesson'; end if;
 result=public.record_lesson(p_request,p_date,p_minutes,p_participants,p_allow_additional);
 if result->>'status'='saved' then
   update public.planned_occurrences set lesson_id=(result->>'lesson_id')::uuid where id=p_occurrence;
   insert into public.audit_events(actor_id,entity,entity_id,action,before_value,after_value)
   values(auth.uid(),'planned_occurrence',p_occurrence,'attendance_recorded',to_jsonb(occurrence),jsonb_build_object('lesson_id',result->>'lesson_id'));
 end if;
 return result;
end;
$$;
revoke all on function public.record_planned_lesson(uuid,integer,uuid,date,integer,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.record_planned_lesson(uuid,integer,uuid,date,integer,jsonb,boolean) to authenticated;
create or replace function public.change_plan_occurrence(p_occurrence uuid,p_scope text,p_new_date date,p_minutes integer,p_students uuid[],p_cancel boolean,p_version integer)
returns public.lesson_plans language plpgsql security definer set search_path='' as $$
declare occurrence public.planned_occurrences; plan public.lesson_plans; target public.planned_occurrences; members uuid[]; offset_days integer; before_rows jsonb;
begin
 if not app_private.has_role('tutor') then raise exception 'Tutor access required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 select o.* into occurrence from public.planned_occurrences o join public.lesson_plans p on p.id=o.plan_id where o.id=p_occurrence and p.tutor_id=auth.uid();
 if not found then raise exception 'Plan unavailable'; end if;
 if occurrence.lesson_id is not null then raise exception 'This occurrence has recorded attendance; edit the saved lesson instead'; end if;
 select * into plan from public.lesson_plans where id=occurrence.plan_id for update;
 if p_version is null or plan.version<>p_version then raise exception 'Plan changed. Reload before editing'; end if;
 if p_scope is null or p_scope not in ('one','future') or p_cancel is null then raise exception 'Choose one lesson or this and future lessons'; end if;
 if not p_cancel then
   if p_new_date is null or not isfinite(p_new_date) or p_minutes is null or p_minutes<=0 then raise exception 'Invalid planned date or duration'; end if;
   perform app_private.check_plan_students(auth.uid(),p_students,p_new_date);
   select array_agg(distinct s order by s) into members from unnest(p_students) s;
 end if;
 offset_days=p_new_date-occurrence.lesson_date;
 select jsonb_agg(to_jsonb(o) order by o.id) into before_rows from public.planned_occurrences o where o.plan_id=plan.id and o.lesson_id is null and (o.id=p_occurrence or (p_scope='future' and o.lesson_date>=occurrence.lesson_date));
 for target in select * from public.planned_occurrences o where o.plan_id=plan.id and o.lesson_id is null and (o.id=p_occurrence or (p_scope='future' and o.lesson_date>=occurrence.lesson_date)) loop
   if p_cancel then update public.planned_occurrences set canceled=true where id=target.id;
   else
     perform app_private.check_plan_students(auth.uid(),members,target.lesson_date+offset_days);
     update public.planned_occurrences set lesson_date=target.lesson_date+offset_days,minutes=p_minutes,student_ids=members where id=target.id;
   end if;
 end loop;
 update public.lesson_plans set version=version+1 where id=plan.id returning * into plan;
 insert into public.audit_events(actor_id,entity,entity_id,action,before_value,after_value)
 values(auth.uid(),'lesson_plan',plan.id,case when p_cancel then 'canceled_' else 'edited_' end||p_scope,before_rows,
   (select jsonb_agg(to_jsonb(o) order by o.id) from public.planned_occurrences o where o.plan_id=plan.id));
 -- Never writes lessons or attendance: a planned occurrence is not a recorded lesson.
 return plan;
end;
$$;
commit;
