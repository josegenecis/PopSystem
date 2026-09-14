create table if not exists public.whatsapp_quick_replies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  shortcut text not null,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, shortcut),
  constraint whatsapp_quick_reply_shortcut_check check (shortcut ~ '^/[a-z0-9_-]{2,30}$'),
  constraint whatsapp_quick_reply_content_check check (char_length(content) between 1 and 2000)
);

create table if not exists public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  label text not null default 'Endereço',
  address text not null,
  neighborhood text,
  reference text,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists customer_addresses_owner_customer_idx
  on public.customer_addresses (user_id, customer_id, is_default desc, updated_at desc);

alter table public.whatsapp_quick_replies enable row level security;
alter table public.customer_addresses enable row level security;

drop policy if exists whatsapp_quick_replies_owner_all on public.whatsapp_quick_replies;
create policy whatsapp_quick_replies_owner_all on public.whatsapp_quick_replies
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists customer_addresses_owner_all on public.customer_addresses;
create policy customer_addresses_owner_all on public.customer_addresses
  for all to authenticated using (
    auth.uid() = user_id and exists (
      select 1 from public.customers customer
      where customer.id = customer_id and customer.user_id = auth.uid()
    )
  ) with check (
    auth.uid() = user_id and exists (
      select 1 from public.customers customer
      where customer.id = customer_id and customer.user_id = auth.uid()
    )
  );

insert into public.whatsapp_quick_replies (user_id, shortcut, content)
select profile.id, seed.shortcut, seed.content
from public.profiles profile
cross join (values
  ('/cardapio', 'Confira nosso cardápio:\n{{link_cardapio}}'),
  ('/horario', 'Olá, {{cliente_nome}}! Vou confirmar nosso horário de atendimento para você.'),
  ('/pagamento', 'Posso gerar uma cobrança PIX segura para o seu pedido.'),
  ('/agradecimento', 'Obrigado pelo contato, {{cliente_nome}}! Estamos à disposição.')
) as seed(shortcut, content)
on conflict (user_id, shortcut) do nothing;
