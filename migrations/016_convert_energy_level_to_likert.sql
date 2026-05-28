DO $$
DECLARE
  constraint_record RECORD;
BEGIN
  FOR constraint_record IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'daily_logs'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%energy_level%'
  LOOP
    EXECUTE format(
      'ALTER TABLE daily_logs DROP CONSTRAINT %I',
      constraint_record.conname
    );
  END LOOP;
END $$;

UPDATE daily_logs
SET energy_level = CASE energy_level
  WHEN 0 THEN 1
  WHEN 1 THEN 3
  WHEN 2 THEN 5
  ELSE energy_level
END
WHERE energy_level BETWEEN 0 AND 2;

ALTER TABLE daily_logs
  ADD CONSTRAINT daily_logs_energy_level_check
  CHECK (energy_level BETWEEN 1 AND 5);
