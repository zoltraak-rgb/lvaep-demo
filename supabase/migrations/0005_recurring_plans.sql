begin;
create table public.lesson_plans (
 id uuid primary key,
 tutor_id uuid not null references public.people(id),
 version integer not null default 1,
 request_payload jsonb not null
);
create table public.planned_occurrences (
 id uuid primary key default gen_random_uuid(),
 plan_id uuid not null references public.lesson_plans(id),
 lesson_date date not null check(isfinite(lesson_date)),
 minutes integer not null check(minutes>0),
 student_ids uuid[] not null check(cardinality(student_ids)>0),
 canceled boolean not null default false
);
alter table public.lesson_plans enable row level security;
alter table public.planned_occurrences enable row level security;
revoke all on public.lesson_plans,public.planned_occurrences from public,anon,authenticated;
grant select on public.lesson_plans,public.planned_occurrences to authenticated;
create policy own_plans on public.lesson_plans for select to authenticated using(tutor_id=auth.uid() and app_private.has_role('tutor'));
create policy own_occurrences on public.planned_occurrences for select to authenticated using(exists(select 1 from public.lesson_plans p where p.id=plan_id));
create function app_private.check_plan_students(p_tutor uuid,p_students uuid[],p_date date) returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_students is null or cardinality(p_students)=0 or array_position(p_students,null) is not null then raise exception 'Select assigned students'; end if;
 if exists(select 1 from unnest(p_students) s where not exists(select 1 from public.assignments a join public.students st on st.id=a.student_id
   where a.student_id=s and a.tutor_id=p_tutor and not st.archived and a.starts_on<=p_date and (a.ends_on is null or a.ends_on>=p_date))) then
   raise exception 'A student is not assigned on a planned date';
 end if;
end;
$$;
revoke all on function app_private.check_plan_students(uuid,uuid[],date) from public,anon,authenticated;
create function public.create_weekly_plan(p_id uuid,p_start date,p_end date,p_minutes integer,p_students uuid[]) returns public.lesson_plans
language plpgsql security definer set search_path='' as $$
declare result public.lesson_plans; payload jsonb; members uuid[]; day date;
begin
 if not app_private.has_role('tutor') then raise exception 'Tutor access required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 if p_id is null or p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end) or p_end<p_start or p_minutes is null or p_minutes<=0 then raise exception 'Invalid plan dates or duration'; end if;
 perform app_private.check_plan_students(auth.uid(),p_students,p_start);
 select array_agg(distinct s order by s) into members from unnest(p_students) s;
 payload=jsonb_build_object('start',p_start,'end',p_end,'minutes',p_minutes,'students',members);
 select * into result from public.lesson_plans where id=p_id;
 if found then
   if result.tutor_id<>auth.uid() or result.request_payload<>payload then raise exception 'Plan retry contents changed'; end if;
   return result;
 end if;
 insert into public.lesson_plans(id,tutor_id,request_payload) values(p_id,auth.uid(),payload) returning * into result;
 day=p_start;
 while day<=p_end loop
   perform app_private.check_plan_students(auth.uid(),members,day);
   insert into public.planned_occurrences(plan_id,lesson_date,minutes,student_ids) values(p_id,day,p_minutes,members);
   exit when p_end-day<7;
   day=day+7;
 end loop;
 insert into public.audit_events(actor_id,entity,entity_id,action,after_value) values(auth.uid(),'lesson_plan',p_id,'created',to_jsonb(result));
 return result;
end;
$$;
create function public.change_plan_occurrence(p_occurrence uuid,p_scope text,p_new_date date,p_minutes integer,p_students uuid[],p_cancel boolean,p_version integer)
returns public.lesson_plans language plpgsql security definer set search_path='' as $$
declare occurrence public.planned_occurrences; plan public.lesson_plans; target public.planned_occurrences; members uuid[]; offset_days integer; before_rows jsonb;
begin
 if not app_private.has_role('tutor') then raise exception 'Tutor access required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 select o.* into occurrence from public.planned_occurrences o join public.lesson_plans p on p.id=o.plan_id where o.id=p_occurrence and p.tutor_id=auth.uid();
 if not found then raise exception 'Plan unavailable'; end if;
 select * into plan from public.lesson_plans where id=occurrence.plan_id for update;
 if p_version is null or plan.version<>p_version then raise exception 'Plan changed. Reload before editing'; end if;
 if p_scope is null or p_scope not in ('one','future') or p_cancel is null then raise exception 'Choose one lesson or this and future lessons'; end if;
 if not p_cancel then
   if p_new_date is null or not isfinite(p_new_date) or p_minutes is null or p_minutes<=0 then raise exception 'Invalid planned date or duration'; end if;
   perform app_private.check_plan_students(auth.uid(),p_students,p_new_date);
   select array_agg(distinct s order by s) into members from unnest(p_students) s;
 end if;
 offset_days=p_new_date-occurrence.lesson_date;
 select jsonb_agg(to_jsonb(o) order by o.id) into before_rows from public.planned_occurrences o where o.plan_id=plan.id and (o.id=p_occurrence or (p_scope='future' and o.lesson_date>=occurrence.lesson_date));
 for target in select * from public.planned_occurrences o where o.plan_id=plan.id and (o.id=p_occurrence or (p_scope='future' and o.lesson_date>=occurrence.lesson_date)) loop
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
revoke all on function public.create_weekly_plan(uuid,date,date,integer,uuid[]),public.change_plan_occurrence(uuid,text,date,integer,uuid[],boolean,integer) from public,anon,authenticated;
grant execute on function public.create_weekly_plan(uuid,date,date,integer,uuid[]),public.change_plan_occurrence(uuid,text,date,integer,uuid[],boolean,integer) to authenticated;
commit;
