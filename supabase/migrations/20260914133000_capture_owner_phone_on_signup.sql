-- Keep the restaurant's public phone separate from the owner's marketing contact.
alter table public.profiles
  add column if not exists owner_phone text;

comment on column public.profiles.owner_phone is
  'Owner WhatsApp captured during signup for activation follow-up and marketing.';

-- Preserve the official 30-day trial provisioning while also copying the owner
-- contact from auth metadata into the newly created profile.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  profile_email text;
  profile_restaurant_name text;
  profile_owner_phone text;
begin
  -- Internal staff accounts must never enter the restaurant customer base or
  -- receive a commercial trial subscription.
  if coalesce(new.raw_user_meta_data ->> 'internal_account_type', '') in ('representative', 'staff') then
    return new;
  end if;

  profile_email := new.email;
  profile_restaurant_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'restaurant_name', ''),
    nullif(new.raw_user_meta_data ->> 'restaurantName', ''),
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    split_part(coalesce(new.email, ''), '@', 1),
    'Restaurante'
  );

  profile_owner_phone := regexp_replace(
    coalesce(
      nullif(new.raw_user_meta_data ->> 'owner_phone', ''),
      nullif(new.raw_user_meta_data ->> 'ownerPhone', ''),
      ''
    ),
    '\D',
    '',
    'g'
  );

  if length(profile_owner_phone) in (10, 11) then
    profile_owner_phone := '55' || profile_owner_phone;
  elsif not (profile_owner_phone like '55%' and length(profile_owner_phone) in (12, 13)) then
    profile_owner_phone := null;
  end if;

  begin
    insert into public.profiles (
      id, email, restaurant_name, owner_phone, created_at, updated_at
    )
    values (
      new.id, profile_email, profile_restaurant_name, profile_owner_phone, now(), now()
    )
    on conflict (id) do update
      set email = coalesce(public.profiles.email, excluded.email),
          restaurant_name = coalesce(nullif(public.profiles.restaurant_name, ''), excluded.restaurant_name),
          owner_phone = coalesce(nullif(public.profiles.owner_phone, ''), excluded.owner_phone),
          updated_at = now();
  exception
    when undefined_column then
      insert into public.profiles (id, created_at, updated_at)
      values (new.id, now(), now())
      on conflict (id) do nothing;
    when others then
      raise warning 'handle_new_user profile provisioning failed for user %: %', new.id, sqlerrm;
  end;

  begin
    insert into public.subscriptions (
      user_id, plan_id, status, trial_start, trial_end, created_at, updated_at
    )
    select new.id, 1, 'trial', now(), now() + interval '30 days', now(), now()
    where not exists (select 1 from public.subscriptions where user_id = new.id);
  exception
    when foreign_key_violation then
      insert into public.subscriptions (
        user_id, status, trial_start, trial_end, created_at, updated_at
      )
      select new.id, 'trial', now(), now() + interval '30 days', now(), now()
      where not exists (select 1 from public.subscriptions where user_id = new.id);
    when undefined_column then
      raise warning 'handle_new_user subscription schema is missing expected columns for user %: %', new.id, sqlerrm;
    when others then
      raise warning 'handle_new_user subscription provisioning failed for user %: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

comment on function public.handle_new_user() is
  'Creates the initial profile with owner contact and an official 30-day trial subscription for new users.';
