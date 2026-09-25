# Task 2A rollback notes

Do not drop `payment_intents`, `payment_attempts`, or `payment_webhook_inbox` after they contain accepted financial evidence. A safe operational rollback disables the new route/worker code and returns application traffic to the previous release while retaining all three tables for audit and reconciliation.

The migration is expand-only: it creates three tables, indexes, constraints, and service-role-only functions. It does not remove or rewrite legacy `orders` columns. If the migration was applied to an empty disposable development database and no evidence exists, the functions and empty tables may be removed manually in dependency order. That destructive cleanup is intentionally not automated.
