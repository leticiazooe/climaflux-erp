PRAGMA foreign_keys = ON;

CREATE TRIGGER IF NOT EXISTS trg_inventory_opening_once
BEFORE INSERT ON stock_movements
WHEN NEW.movement_type = 'opening'
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM stock_movements m
    WHERE m.tenant_id = NEW.tenant_id
      AND m.item_id = NEW.item_id
      AND m.location_id = NEW.location_id
  ) THEN RAISE(ABORT, 'INVENTORY_OPENING_ALREADY_EXISTS') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_inventory_work_order_issue_status
BEFORE INSERT ON stock_movements
WHEN NEW.movement_type = 'work_order_issue'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM work_orders w
    WHERE w.tenant_id = NEW.tenant_id
      AND w.id = NEW.reference_id
      AND w.deleted_at IS NULL
      AND w.status NOT IN ('completed', 'cancelled')
  ) THEN RAISE(ABORT, 'INVENTORY_WORK_ORDER_INVALID') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_inventory_work_order_return_limit
BEFORE INSERT ON stock_movements
WHEN NEW.movement_type = 'work_order_return'
BEGIN
  SELECT CASE WHEN NEW.quantity_delta > COALESCE((
    SELECT -SUM(m.quantity_delta)
    FROM stock_movements m
    WHERE m.tenant_id = NEW.tenant_id
      AND m.item_id = NEW.item_id
      AND m.location_id = NEW.location_id
      AND m.reference_type = 'work_order'
      AND m.reference_id = NEW.reference_id
      AND m.movement_type IN ('work_order_issue', 'work_order_return')
  ), 0) + 0.000001 THEN RAISE(ABORT, 'INVENTORY_RETURN_EXCEEDS_ISSUED') END;
END;

INSERT INTO schema_metadata (key, value, updated_at)
VALUES ('schema_version', '6', CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
