begin;
create table public.student_requests (
 id uuid primary key,
 tutor_id uuid not null references public.people(id),
 display_name text not null check(length(trim(display_name)) between 1 and 120),
 context text not null default '' check(length(context)<=1000),
 status text not null default 'pending' check(status in ('pending','resolved','rejected')),
 student_id uuid references public.students(id),
 version integer not null default 1,
 created_at timestamptz not null default now(),
 check((status='resolved')=(student_id is not null))
);
alter table public.student_requests enable row level security;
revoke all on public.student_requests from public,anon,authenticated;
grant select on public.student_requests to authenticated;
create policy student_requests_read on public.student_requests for select to authenticated using(
 app_private.is_staff() or (tutor_id=auth.uid() and app_private.has_role('tutor'))
);
create function public.request_missing_student(p_id uuid,p_name text,p_context text default '') returns public.student_requests
language plpgsql security definer set search_path='' as $$
declare saved public.student_requests;
begin
 if not app_private.has_role('tutor') then raise exception 'Tutor access required' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 if p_id is null or p_name is null or length(trim(p_name)) not between 1 and 120 or p_context is null or length(p_context)>1000 then raise exception 'Enter a student name and brief context'; end if;
 select * into saved from public.student_requests where id=p_id;
 if found then
  if saved.tutor_id<>auth.uid() or saved.display_name<>trim(p_name) or saved.context<>trim(p_context) then raise exception 'Request retry does not match'; end if;
  return saved;
 end if;
 -- Names are not identity keys. Distinct requests are never silently merged by name.
 insert into public.student_requests(id,tutor_id,display_name,context) values(p_id,auth.uid(),trim(p_name),trim(p_context)) returning * into saved;
 insert into public.audit_events(actor_id,entity,entity_id,action,after_value) values(auth.uid(),'student_request',p_id,'created',to_jsonb(saved));
 return saved;
end;
$$;
revoke all on function public.request_missing_student(uuid,text,text) from public,anon,authenticated;
grant execute on function public.request_missing_student(uuid,text,text) to authenticated;
commit;
