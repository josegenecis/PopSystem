create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.unschedule(jobid)
from cron.job
where jobname = 'popsystem-ifood-poller';

do $$
declare
  poller_url text := current_setting('app.settings.ifood_poller_url', true);
begin
  -- Ambientes novos ficam seguros por padrao. O poller so e ativado depois que
  -- a URL do proprio ambiente for configurada explicitamente no Postgres.
  if nullif(trim(poller_url), '') is not null then
    perform cron.schedule(
      'popsystem-ifood-poller',
      '30 seconds',
      format(
        $job$
          select net.http_post(
            url := %L,
            headers := jsonb_build_object('Content-Type', 'application/json'),
            body := jsonb_build_object('scheduledAt', now()),
            timeout_milliseconds := 20000
          ) as request_id;
        $job$,
        poller_url
      )
    );
  end if;
end;
$$;
