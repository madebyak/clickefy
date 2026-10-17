-- `voice_charge` ledger reason (2026-10-17): a voice clone or design,
-- charged without a job behind it. Own file because Postgres cannot run
-- ADD VALUE inside a transaction block.

ALTER TYPE "credit_reason" ADD VALUE IF NOT EXISTS 'voice_charge';
