-- Stop the daily Fortnight Finance ASB sync.
select cron.unschedule(jobid)
from cron.job
where jobname = 'fortnight-finance-asb-sync-daily';
