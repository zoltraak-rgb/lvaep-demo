begin;
-- Server-only ledger. No addresses, credentials, access links or tokens are stored.
create table app_private.access_mail_deliveries (
  delivery_key text primary key check (delivery_key ~ '^[a-f0-9]{64}$'),
  state text not null check (state in ('pending','accepted','rejected','unknown')),
  claimed_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz
);
-- Disabled until an operator verifies the provider's remaining free allowance.
-- A conservative local allowance, not a claim about the provider billing cycle.
create table app_private.access_mail_budget (
  singleton boolean primary key default true check(singleton),
  allowance integer not null default 0 check(allowance >= 0),
  reserved integer not null default 0 check(reserved >= 0 and reserved <= allowance),
  enabled boolean not null default false,
  next_send_at timestamptz not null default '-infinity'
);
insert into app_private.access_mail_budget(singleton) values(true);
revoke all on app_private.access_mail_deliveries, app_private.access_mail_budget from public,anon,authenticated,service_role;

create function public.claim_access_mail(p_key text) returns text
language plpgsql security definer set search_path = '' as $$
declare prior_state text; budget app_private.access_mail_budget%rowtype;
begin
  if p_key is null or p_key !~ '^[a-f0-9]{64}$' then raise exception 'Invalid delivery key'; end if;
  -- Serializes ledger claims and global provider throughput across workers.
  select * into budget from app_private.access_mail_budget where singleton for update;
  select state into prior_state from app_private.access_mail_deliveries where delivery_key=p_key;
  if found then return case when prior_state='accepted' then 'accepted' else 'blocked' end; end if;
  if not budget.enabled or budget.reserved >= budget.allowance or clock_timestamp() < budget.next_send_at then
    return 'blocked';
  end if;
  insert into app_private.access_mail_deliveries(delivery_key,state) values(p_key,'pending');
  update app_private.access_mail_budget set reserved=reserved+1,next_send_at=clock_timestamp()+interval '1 second' where singleton;
  return 'claimed';
end;
$$;
create function public.finish_access_mail(p_key text,p_state text) returns void
language plpgsql security definer set search_path = '' as $$
declare prior_state text;
begin
  if p_state is null or p_state not in ('accepted','rejected','unknown') then raise exception 'Invalid delivery outcome'; end if;
  select state into prior_state from app_private.access_mail_deliveries where delivery_key=p_key for update;
  if not found then raise exception 'Delivery was not claimed'; end if;
  if prior_state=p_state then return; end if;
  if prior_state <> 'pending' then raise exception 'Delivery outcome already recorded'; end if;
  update app_private.access_mail_deliveries set state=p_state,finished_at=clock_timestamp() where delivery_key=p_key;
  -- No refund: even a rejected/unknown attempt conservatively consumes allowance.
end;
$$;
revoke all on function public.claim_access_mail(text),public.finish_access_mail(text,text) from public,anon,authenticated;
grant execute on function public.claim_access_mail(text),public.finish_access_mail(text,text) to service_role;
commit;
