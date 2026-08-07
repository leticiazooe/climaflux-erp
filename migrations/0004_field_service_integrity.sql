PRAGMA foreign_keys = ON;

CREATE TRIGGER IF NOT EXISTS trg_work_order_terminal_active_visit_guard
BEFORE UPDATE OF status ON work_orders
WHEN NEW.status IN ('completed', 'cancelled')
  AND OLD.status NOT IN ('completed', 'cancelled')
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM service_visits v
    WHERE v.tenant_id = OLD.tenant_id
      AND v.work_order_id = OLD.id
      AND v.status NOT IN ('completed', 'cancelled')
  ) THEN RAISE(ABORT, 'WORK_ORDER_ACTIVE_VISIT_EXISTS') END;
END;

INSERT INTO schema_metadata (key, value, updated_at)
VALUES ('schema_version', '4', CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
