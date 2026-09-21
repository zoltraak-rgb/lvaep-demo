begin;
create table public.tutor_groups (
 id uuid primary key,
 tutor_id uuid not null references public.people(id),
 name text not null check(length(trim(name)) between 1 and 80),
 student_ids uuid[] not null check(cardinality(student_ids)>0),
 archived boolean not null default false,
 version integer not null default 1
);
alter table public.tutor_groups enable row level security;
revoke all on public.tutor_groups from public,anon,authenticated;
grant select on public.tutor_groups to authenticated;
create policy own_groups on public.tutor_groups for select to authenticated using(tutor_id=auth.uid() and app_private.has_role('tutor'));
create function public.save_tutor_group(p_id uuid,p_name text,p_students uuid[],p_archived boolean,p_version integer)
returns public.tutor_groups language plpgsql security definer set search_path='' as $$
declare old_row public.tutor_groups; new_row public.tutor_groups; members uuid[];
begin
 if not app_private.has_role('tutor') then raise exception 'Tutor access required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 if p_id is null or p_name is null or length(trim(p_name)) not between 1 and 80 or p_archived is null or p_version is null then raise exception 'Invalid group'; end if;
 if p_students is null or cardinality(p_students)=0 or array_position(p_students,null) is not null then raise exception 'Choose assigned students'; end if;
 select array_agg(distinct s order by s) into members from unnest(p_students) s;
 if exists(select 1 from unnest(members) s where not exists(select 1 from public.assignments a where a.tutor_id=auth.uid() and a.student_id=s)) then raise exception 'Choose assigned students'; end if;
 select * into old_row from public.tutor_groups where id=p_id for update;
 if found then
   if old_row.tutor_id<>auth.uid() then raise exception 'Group unavailable'; end if;
   if old_row.name=trim(p_name) and old_row.student_ids=members and old_row.archived=p_archived then return old_row; end if;
   if old_row.version<>p_version then raise exception 'Group changed. Reload before editing'; end if;
   update public.tutor_groups set name=trim(p_name),student_ids=members,archived=p_archived,version=version+1 where id=p_id returning * into new_row;
 else
   if p_version<>0 then raise exception 'Group changed. Reload before editing'; end if;
   insert into public.tutor_groups(id,tutor_id,name,student_ids,archived) values(p_id,auth.uid(),trim(p_name),members,p_archived) returning * into new_row;
 end if;
 insert into public.audit_events(actor_id,entity,entity_id,action,before_value,after_value) values(auth.uid(),'tutor_group',p_id,'saved',to_jsonb(old_row),to_jsonb(new_row));
 return new_row;
end;
$$;
revoke all on function public.save_tutor_group(uuid,text,uuid[],boolean,integer) from public,anon,authenticated;
grant execute on function public.save_tutor_group(uuid,text,uuid[],boolean,integer) to authenticated;
commit;
