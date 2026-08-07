PRAGMA foreign_keys = ON;

CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_tenant_identity
  ON customers(tenant_id, id);

CREATE TABLE IF NOT EXISTS equipment (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  code TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'air_conditioner',
  brand TEXT,
  model TEXT,
  serial_number TEXT,
  asset_tag TEXT,
  capacity_btu INTEGER,
  refrigerant TEXT,
  location TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'retired')),
  notes TEXT,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE (tenant_id, code),
  UNIQUE (tenant_id, serial_number),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_equipment_tenant_identity ON equipment(tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_equipment_tenant_customer ON equipment(tenant_id, customer_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_equipment_tenant_search ON equipment(tenant_id, brand, model, serial_number, asset_tag);

CREATE TABLE IF NOT EXISTS work_orders (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  equipment_id TEXT,
  technician_user_id TEXT,
  code TEXT NOT NULL,
  service_type TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'critical')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('draft', 'open', 'scheduled', 'in_progress', 'on_hold', 'completed', 'cancelled')),
  scheduled_start TEXT,
  scheduled_end TEXT,
  sla_due_at TEXT,
  started_at TEXT,
  completed_at TEXT,
  resolution TEXT,
  notes TEXT,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE (tenant_id, code),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, customer_id) REFERENCES customers(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, equipment_id) REFERENCES equipment(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (technician_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_work_orders_tenant_identity ON work_orders(tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_work_orders_tenant_status_priority ON work_orders(tenant_id, status, priority, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_work_orders_tenant_customer ON work_orders(tenant_id, customer_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_work_orders_tenant_equipment ON work_orders(tenant_id, equipment_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_work_orders_tenant_technician ON work_orders(tenant_id, technician_user_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_work_orders_tenant_sla ON work_orders(tenant_id, sla_due_at, status);

CREATE TABLE IF NOT EXISTS work_order_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  work_order_id TEXT NOT NULL,
  actor_user_id TEXT,
  event_type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  note TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, work_order_id) REFERENCES work_orders(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_work_order_events_tenant_order ON work_order_events(tenant_id, work_order_id, created_at DESC);

CREATE TRIGGER IF NOT EXISTS trg_work_order_equipment_customer_insert
BEFORE INSERT ON work_orders
WHEN NEW.equipment_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM equipment e
    WHERE e.id = NEW.equipment_id
      AND e.tenant_id = NEW.tenant_id
      AND e.customer_id = NEW.customer_id
      AND e.deleted_at IS NULL
  ) THEN RAISE(ABORT, 'WORK_ORDER_EQUIPMENT_CUSTOMER_MISMATCH') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_work_order_equipment_customer_update
BEFORE UPDATE OF equipment_id, customer_id, tenant_id ON work_orders
WHEN NEW.equipment_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM equipment e
    WHERE e.id = NEW.equipment_id
      AND e.tenant_id = NEW.tenant_id
      AND e.customer_id = NEW.customer_id
      AND e.deleted_at IS NULL
  ) THEN RAISE(ABORT, 'WORK_ORDER_EQUIPMENT_CUSTOMER_MISMATCH') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_work_order_events_immutable_update
BEFORE UPDATE ON work_order_events
BEGIN
  SELECT RAISE(ABORT, 'WORK_ORDER_EVENT_IMMUTABLE');
END;

INSERT INTO schema_metadata (key, value, updated_at)
VALUES ('schema_version', '2', CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
