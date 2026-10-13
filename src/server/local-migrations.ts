/** Ordered local schema contract shared by setup, disposable probes and encrypted backup validation. */
export const localCareMigrations = [
  '002_local_care.sql',
  '003_activity_ledger.sql',
  '004_client_readiness.sql',
  '005_runtime_observability.sql',
  '006_family_task_requests.sql',
  '007_meals_groceries.sql',
  '008_local_day.sql',
  '009_programs.sql',
  '010_support_team.sql',
  '011_progress.sql',
  '012_operations.sql',
] as const;
