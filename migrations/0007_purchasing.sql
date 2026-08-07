PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  document TEXT,
  email TEXT,
  phone TEXT,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_tenant_document_active
  ON suppliers(tenant_id, document) WHERE document IS NOT NULL AND status = 'active';
CREATE INDEX IF NOT EXISTS idx_suppliers_tenant_status_name ON suppliers(tenant_id, status, name);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  supplier_id TEXT NOT NULL,
  code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','ordered','partially_received','received','cancelled')),
  expected_date TEXT,
  notes TEXT,
  approved_by TEXT,
  approved_at TEXT,
  ordered_at TEXT,
  cancelled_at TEXT,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, supplier_id) REFERENCES suppliers(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_tenant_status ON purchase_orders(tenant_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_tenant_supplier ON purchase_orders(tenant_id, supplier_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS purchase_order_lines (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  purchase_order_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  quantity_ordered REAL NOT NULL CHECK (quantity_ordered > 0),
  quantity_received REAL NOT NULL DEFAULT 0 CHECK (quantity_received >= 0 AND quantity_received <= quantity_ordered + 0.000001),
  unit_cost_cents INTEGER NOT NULL CHECK (unit_cost_cents >= 0),
  notes TEXT,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, purchase_order_id, item_id),
  FOREIGN KEY (tenant_id, purchase_order_id) REFERENCES purchase_orders(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, item_id) REFERENCES stock_items(tenant_id, id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_purchase_order_lines_tenant_order ON purchase_order_lines(tenant_id, purchase_order_id);

CREATE TABLE IF NOT EXISTS purchase_receipts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  purchase_order_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  code TEXT NOT NULL,
  request_key TEXT NOT NULL,
  notes TEXT,
  received_by TEXT NOT NULL,
  received_at TEXT NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code),
  UNIQUE (tenant_id, request_key),
  FOREIGN KEY (tenant_id, purchase_order_id) REFERENCES purchase_orders(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, location_id) REFERENCES stock_locations(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (received_by) REFERENCES users(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_purchase_receipts_tenant_order ON purchase_receipts(tenant_id, purchase_order_id, received_at DESC);

CREATE TABLE IF NOT EXISTS purchase_receipt_lines (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  receipt_id TEXT NOT NULL,
  purchase_order_line_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  quantity_received REAL NOT NULL CHECK (quantity_received > 0),
  unit_cost_cents INTEGER NOT NULL CHECK (unit_cost_cents >= 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, receipt_id, purchase_order_line_id),
  FOREIGN KEY (tenant_id, receipt_id) REFERENCES purchase_receipts(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, purchase_order_line_id) REFERENCES purchase_order_lines(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, item_id) REFERENCES stock_items(tenant_id, id) ON DELETE RESTRICT
);

CREATE TRIGGER IF NOT EXISTS trg_purchase_order_supplier_active
BEFORE INSERT ON purchase_orders
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM suppliers s WHERE s.tenant_id = NEW.tenant_id AND s.id = NEW.supplier_id AND s.status = 'active'
  ) THEN RAISE(ABORT, 'PURCHASE_SUPPLIER_INVALID') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_purchase_order_line_item_active
BEFORE INSERT ON purchase_order_lines
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM stock_items i WHERE i.tenant_id = NEW.tenant_id AND i.id = NEW.item_id AND i.status = 'active'
  ) THEN RAISE(ABORT, 'PURCHASE_ITEM_INVALID') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_purchase_receipt_order_status
BEFORE INSERT ON purchase_receipts
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM purchase_orders p
    WHERE p.tenant_id = NEW.tenant_id AND p.id = NEW.purchase_order_id
      AND p.status IN ('ordered', 'partially_received')
  ) THEN RAISE(ABORT, 'PURCHASE_RECEIPT_ORDER_INVALID') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM stock_locations l
    WHERE l.tenant_id = NEW.tenant_id AND l.id = NEW.location_id AND l.status = 'active'
  ) THEN RAISE(ABORT, 'PURCHASE_RECEIPT_LOCATION_INVALID') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_purchase_receipt_line_validate
BEFORE INSERT ON purchase_receipt_lines
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM purchase_order_lines pol
    JOIN purchase_receipts pr ON pr.tenant_id = pol.tenant_id AND pr.purchase_order_id = pol.purchase_order_id
    WHERE pr.tenant_id = NEW.tenant_id
      AND pr.id = NEW.receipt_id
      AND pol.id = NEW.purchase_order_line_id
      AND pol.item_id = NEW.item_id
      AND NEW.quantity_received <= (pol.quantity_ordered - pol.quantity_received) + 0.000001
  ) THEN RAISE(ABORT, 'PURCHASE_RECEIPT_QUANTITY_INVALID') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_purchase_receipt_line_apply
AFTER INSERT ON purchase_receipt_lines
BEGIN
  UPDATE purchase_order_lines
  SET quantity_received = quantity_received + NEW.quantity_received
  WHERE tenant_id = NEW.tenant_id AND id = NEW.purchase_order_line_id;

  INSERT INTO stock_movements (
    id, tenant_id, item_id, location_id, movement_type, quantity_delta, unit_cost_cents,
    reference_type, reference_id, notes, request_key, actor_user_id, created_at
  )
  SELECT
    lower(hex(randomblob(16))), NEW.tenant_id, NEW.item_id, pr.location_id, 'receipt', NEW.quantity_received,
    NEW.unit_cost_cents, 'purchase_receipt', NEW.receipt_id, pr.notes,
    'purchase:' || NEW.receipt_id || ':' || NEW.id, pr.received_by, pr.received_at
  FROM purchase_receipts pr
  WHERE pr.tenant_id = NEW.tenant_id AND pr.id = NEW.receipt_id;

  UPDATE purchase_orders
  SET status = CASE
      WHEN NOT EXISTS (
        SELECT 1 FROM purchase_order_lines line
        WHERE line.tenant_id = NEW.tenant_id
          AND line.purchase_order_id = purchase_orders.id
          AND line.quantity_received + 0.000001 < line.quantity_ordered
      ) THEN 'received'
      ELSE 'partially_received'
    END,
    updated_at = (SELECT received_at FROM purchase_receipts WHERE tenant_id = NEW.tenant_id AND id = NEW.receipt_id),
    updated_by = (SELECT received_by FROM purchase_receipts WHERE tenant_id = NEW.tenant_id AND id = NEW.receipt_id)
  WHERE tenant_id = NEW.tenant_id
    AND id = (SELECT purchase_order_id FROM purchase_receipts WHERE tenant_id = NEW.tenant_id AND id = NEW.receipt_id);
END;

CREATE TRIGGER IF NOT EXISTS trg_purchase_receipts_immutable_update
BEFORE UPDATE ON purchase_receipts
BEGIN SELECT RAISE(ABORT, 'PURCHASE_RECEIPT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_purchase_receipts_immutable_delete
BEFORE DELETE ON purchase_receipts
BEGIN SELECT RAISE(ABORT, 'PURCHASE_RECEIPT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_purchase_receipt_lines_immutable_update
BEFORE UPDATE ON purchase_receipt_lines
BEGIN SELECT RAISE(ABORT, 'PURCHASE_RECEIPT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_purchase_receipt_lines_immutable_delete
BEFORE DELETE ON purchase_receipt_lines
BEGIN SELECT RAISE(ABORT, 'PURCHASE_RECEIPT_IMMUTABLE'); END;

INSERT INTO schema_metadata (key, value, updated_at)
VALUES ('schema_version', '7', CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
