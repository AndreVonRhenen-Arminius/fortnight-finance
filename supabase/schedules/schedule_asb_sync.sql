-- Fortnight Finance v1.4 — schedule the read-only ASB/Akahu sync once daily.
-- Run this only AFTER manual ASB sync has been tested successfully.
-- Replace both placeholders before running.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

-- Run these two create_secret statements once.
select vault.create_secret(
  'https://YOUR-PROJECT-REF.supabase.co',
  'fortnight_finance_project_url',
  'Fortnight Finance Supabase project URL'
);

select vault.create_secret(
  'PASTE-THE-SAME-FINANCE-CRON-SECRET-HERE',
  'fortnight_finance_cron_secret',
  'Fortnight Finance ASB sync cron authentication secret'
);

-- 08:15 UTC is approximately 8:15pm NZST or 9:15pm NZDT.
select cron.schedule(
  'fortnight-finance-asb-sync-daily',
  '15 8 * * *',
  $$
  select net.http_post(
    url := (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'fortnight_finance_project_url'
      limit 1
    ) || '/functions/v1/asb-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'fortnight_finance_cron_secret'
        limit 1
      )
    ),
    body := '{"action":"sync","requestRefresh":false}'::jsonb
  );
  $$
);

-- Verify the job exists.
select jobid, jobname, schedule, active
from cron.job
where jobname = 'fortnight-finance-asb-sync-daily';
