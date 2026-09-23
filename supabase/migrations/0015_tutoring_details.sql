begin;
alter table public.assignments add column tutoring_site text not null default '' check(length(tutoring_site)<=200);
alter table public.assignments add column regular_schedule text not null default '' check(length(regular_schedule)<=300);
create function public.save_tutoring_details(p_id uuid,p_version integer,p_site text,p_schedule text) returns public.assignments
language plpgsql security definer set search_path='' as $$
declare original public.assignments; saved public.assignments;
begin
 select * into original from public.assignments where id=p_id;
 if not found or not(app_private.is_staff() or (original.tutor_id=auth.uid() and app_private.has_role('tutor'))) then raise exception 'Assignment access denied' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(original.tutor_id::text,0));
 select * into original from public.assignments where id=p_id for update;
 if p_version is null or p_site is null or p_schedule is null or length(p_site)>200 or length(p_schedule)>300 then raise exception 'Keep site and schedule details brief'; end if;
 if original.version=p_version+1 and original.tutoring_site=trim(p_site) and original.regular_schedule=trim(p_schedule) then return original; end if;
 if original.version<>p_version then raise exception 'Assignment changed. Reopen before editing.' using errcode='40001'; end if;
 update public.assignments set tutoring_site=trim(p_site),regular_schedule=trim(p_schedule),version=version+1 where id=p_id returning * into saved;
 insert into public.audit_events(actor_id,entity,entity_id,action,before_value,after_value) values(auth.uid(),'assignment',p_id,'details_updated',to_jsonb(original),to_jsonb(saved));
 return saved;
end;
$$;
revoke all on function public.save_tutoring_details(uuid,integer,text,text) from public,anon,authenticated;
grant execute on function public.save_tutoring_details(uuid,integer,text,text) to authenticated;
commit;
