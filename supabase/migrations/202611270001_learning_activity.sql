begin;
create schema if not exists mytraectory_presence;
revoke all on schema mytraectory_presence from public, anon, authenticated;

create table if not exists mytraectory_presence.learning_activity (
  student_id uuid primary key references public.profiles(id) on delete cascade,
  last_active_at timestamptz not null
);
alter table mytraectory_presence.learning_activity enable row level security;
revoke all on table mytraectory_presence.learning_activity from public, anon, authenticated;

create index if not exists learning_activity_time_idx
  on mytraectory_presence.learning_activity (last_active_at);

create or replace function public.mark_learning_activity()
returns void
language plpgsql security definer set search_path = ''
as $fn$
declare actor uuid := auth.uid();
begin
  if actor is null or not exists (
    select from public.profiles p where p.id = actor and p.role = 'student'
  ) then
    raise exception 'Student access required' using errcode = '42501';
  end if;

  insert into mytraectory_presence.learning_activity as activity (student_id, last_active_at)
  values (actor, pg_catalog.statement_timestamp())
  on conflict (student_id) do update set last_active_at = excluded.last_active_at
  where activity.last_active_at <= excluded.last_active_at - interval '25 seconds';
end;
$fn$;

create or replace function public.learning_activity_counts()
returns table (active_count integer, total_count integer)
language plpgsql stable security definer set search_path = ''
as $fn$
declare actor uuid := auth.uid();
begin
  if actor is null or not exists (
    select from public.profiles p where p.id = actor and p.role in ('student', 'teacher')
  ) then
    raise exception 'School account required' using errcode = '42501';
  end if;

  return query
  select pg_catalog.count(a.student_id)::integer, pg_catalog.count(*)::integer
  from public.profiles p
  left join mytraectory_presence.learning_activity a on a.student_id = p.id
    and a.last_active_at > pg_catalog.statement_timestamp() - interval '5 minutes'
  where p.role = 'student';
end;
$fn$;

create or replace function public.active_learning_students()
returns table (student_name text, class_label text)
language plpgsql stable security definer set search_path = ''
as $fn$
declare actor uuid := auth.uid();
begin
  if actor is null or not exists (
    select from public.profiles p where p.id = actor and p.role = 'teacher'
  ) then
    raise exception 'Teacher access required' using errcode = '42501';
  end if;

  return query
  select p.full_name::text,
    case when p.class_number is null then 'Без класса'
      else p.class_number::text || case p.class_letter when 'a' then 'А' when 'b' then 'Б' else '' end
    end
  from mytraectory_presence.learning_activity a
  join public.profiles p on p.id = a.student_id and p.role = 'student'
  where a.last_active_at > pg_catalog.statement_timestamp() - interval '5 minutes'
  order by p.class_number, p.class_letter, p.full_name;
end;
$fn$;

revoke all on function public.mark_learning_activity() from public, anon, authenticated;
revoke all on function public.learning_activity_counts() from public, anon, authenticated;
revoke all on function public.active_learning_students() from public, anon, authenticated;
grant execute on function public.mark_learning_activity() to authenticated;
grant execute on function public.learning_activity_counts() to authenticated;
grant execute on function public.active_learning_students() to authenticated;
notify pgrst, 'reload schema';
commit;
