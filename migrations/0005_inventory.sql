PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS stock_locations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, code),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_locations_tenant_identity ON stock_locations(tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_stock_locations_tenant_status ON stock_locations(tenant_id, status, name);

CREATE TABLE IF NOT EXISTS stock_items (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  unit TEXT NOT NULL DEFAULT 'un',
  minimum_quantity REAL NOT NULL DEFAULT 0 CHECK (minimum_quantity >= 0),
  reference_cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (reference_cost_cents >= 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, sku),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_items_tenant_identity ON stock_items(tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_stock_items_tenant_status_name ON stock_items(tenant_id, status, name);

CREATE TABLE IF NOT EXISTS stock_balances (
  tenant_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, item_id, location_id),
  FOREIGN KEY (tenant_id, item_id) REFERENCES stock_items(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, location_id) REFERENCES stock_locations(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_stock_balances_tenant_location ON stock_balances(tenant_id, location_id, quantity);
CREATE INDEX IF NOT EXISTS idx_stock_balances_tenant_item ON stock_balances(tenant_id, item_id, quantity);

CREATE TABLE IF NOT EXISTS stock_movements (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  movement_type TEXT NOT NULL CHECK (movement_type IN (
    'opening', 'receipt', 'issue', 'return', 'adjustment_in', 'adjustment_out', 'work_order_issue', 'work_order_return'
  )),
  quantity_delta REAL NOT NULL CHECK (quantity_delta <> 0),
  unit_cost_cents INTEGER CHECK (unit_cost_cents IS NULL OR unit_cost_cents >= 0),
  reference_type TEXT,
  reference_id TEXT,
  notes TEXT,
  request_key TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (tenant_id, request_key),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, item_id) REFERENCES stock_items(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, location_id) REFERENCES stock_locations(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_stock_movements_tenant_item ON stock_movements(tenant_id, item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_tenant_location ON stock_movements(tenant_id, location_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stock_movements_tenant_reference ON stock_movements(tenant_id, reference_type, reference_id, created_at DESC);

CREATE TRIGGER IF NOT EXISTS trg_stock_movement_entities_active
BEFORE INSERT ON stock_movements
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM stock_items i
    WHERE i.tenant_id = NEW.tenant_id AND i.id = NEW.item_id AND i.status = 'active'
  ) THEN RAISE(ABORT, 'INVENTORY_ITEM_INACTIVE') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM stock_locations l
    WHERE l.tenant_id = NEW.tenant_id AND l.id = NEW.location_id AND l.status = 'active'
  ) THEN RAISE(ABORT, 'INVENTORY_LOCATION_INACTIVE') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_stock_movement_direction
BEFORE INSERT ON stock_movements
BEGIN
  SELECT CASE
    WHEN NEW.movement_type IN ('opening', 'receipt', 'return', 'adjustment_in', 'work_order_return') AND NEW.quantity_delta <= 0
      THEN RAISE(ABORT, 'INVENTORY_DIRECTION_INVALID')
    WHEN NEW.movement_type IN ('issue', 'adjustment_out', 'work_order_issue') AND NEW.quantity_delta >= 0
      THEN RAISE(ABORT, 'INVENTORY_DIRECTION_INVALID')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_stock_movement_work_order_reference
BEFORE INSERT ON stock_movements
WHEN NEW.movement_type IN ('work_order_issue', 'work_order_return')
BEGIN
  SELECT CASE WHEN NEW.reference_type <> 'work_order' OR NEW.reference_id IS NULL
    THEN RAISE(ABORT, 'INVENTORY_WORK_ORDER_REQUIRED') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM work_orders w
    WHERE w.tenant_id = NEW.tenant_id
      AND w.id = NEW.reference_id
      AND w.deleted_at IS NULL
  ) THEN RAISE(ABORT, 'INVENTORY_WORK_ORDER_INVALID') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_stock_movement_negative_guard
BEFORE INSERT ON stock_movements
WHEN NEW.quantity_delta < 0
BEGIN
  SELECT CASE WHEN (
    COALESCE((
      SELECT b.quantity FROM stock_balances b
      WHERE b.tenant_id = NEW.tenant_id
        AND b.item_id = NEW.item_id
        AND b.location_id = NEW.location_id
    ), 0) + NEW.quantity_delta
  ) < -0.000001 THEN RAISE(ABORT, 'INVENTORY_NEGATIVE_BALANCE') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_stock_movement_apply_balance
AFTER INSERT ON stock_movements
BEGIN
  INSERT INTO stock_balances (tenant_id, item_id, location_id, quantity, updated_by, updated_at)
  VALUES (NEW.tenant_id, NEW.item_id, NEW.location_id, NEW.quantity_delta, NEW.actor_user_id, NEW.created_at)
  ON CONFLICT(tenant_id, item_id, location_id) DO UPDATE SET
    quantity = stock_balances.quantity + excluded.quantity,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER IF NOT EXISTS trg_stock_movements_immutable_update
BEFORE UPDATE ON stock_movements
BEGIN
  SELECT RAISE(ABORT, 'INVENTORY_MOVEMENT_IMMUTABLE');
END;

CREATE TRIGGER IF NOT EXISTS trg_stock_movements_immutable_delete
BEFORE DELETE ON stock_movements
BEGIN
  SELECT RAISE(ABORT, 'INVENTORY_MOVEMENT_IMMUTABLE');
END;

INSERT INTO schema_metadata (key, value, updated_at)
VALUES ('schema_version', '5', CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
