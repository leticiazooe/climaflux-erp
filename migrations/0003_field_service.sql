PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS service_visits (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  work_order_id TEXT NOT NULL,
  technician_user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'en_route', 'on_site', 'completed', 'cancelled')),
  scheduled_start TEXT NOT NULL,
  scheduled_end TEXT,
  arrival_at TEXT,
  departure_at TEXT,
  notes TEXT,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, work_order_id) REFERENCES work_orders(tenant_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (tenant_id, technician_user_id) REFERENCES memberships(tenant_id, user_id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_service_visits_tenant_schedule
  ON service_visits(tenant_id, scheduled_start, status);
CREATE INDEX IF NOT EXISTS idx_service_visits_tenant_technician
  ON service_visits(tenant_id, technician_user_id, scheduled_start);
CREATE INDEX IF NOT EXISTS idx_service_visits_tenant_work_order
  ON service_visits(tenant_id, work_order_id, created_at DESC);

CREATE TABLE IF NOT EXISTS visit_checklist_items (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  visit_id TEXT NOT NULL,
  item_key TEXT NOT NULL,
  label TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ok', 'not_ok', 'na')),
  note TEXT,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (tenant_id, visit_id, item_key),
  FOREIGN KEY (tenant_id, visit_id) REFERENCES service_visits(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_visit_checklist_tenant_visit
  ON visit_checklist_items(tenant_id, visit_id, position, item_key);

CREATE TABLE IF NOT EXISTS visit_measurements (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  visit_id TEXT NOT NULL,
  name TEXT NOT NULL,
  value_number REAL,
  value_text TEXT,
  unit TEXT,
  recorded_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (value_number IS NOT NULL OR value_text IS NOT NULL),
  FOREIGN KEY (tenant_id, visit_id) REFERENCES service_visits(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (recorded_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_visit_measurements_tenant_visit
  ON visit_measurements(tenant_id, visit_id, created_at DESC);

CREATE TABLE IF NOT EXISTS service_visit_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  visit_id TEXT NOT NULL,
  actor_user_id TEXT,
  event_type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  note TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id, visit_id) REFERENCES service_visits(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_service_visit_events_tenant_visit
  ON service_visit_events(tenant_id, visit_id, created_at DESC);

CREATE TRIGGER IF NOT EXISTS trg_service_visit_technician_insert
BEFORE INSERT ON service_visits
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM memberships m
    JOIN users u ON u.id = m.user_id
    WHERE m.tenant_id = NEW.tenant_id
      AND m.user_id = NEW.technician_user_id
      AND m.role = 'tecnico'
      AND m.status = 'active'
      AND u.status = 'active'
  ) THEN RAISE(ABORT, 'FIELD_TECHNICIAN_INVALID') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_service_visit_technician_update
BEFORE UPDATE OF technician_user_id, tenant_id ON service_visits
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM memberships m
    JOIN users u ON u.id = m.user_id
    WHERE m.tenant_id = NEW.tenant_id
      AND m.user_id = NEW.technician_user_id
      AND m.role = 'tecnico'
      AND m.status = 'active'
      AND u.status = 'active'
  ) THEN RAISE(ABORT, 'FIELD_TECHNICIAN_INVALID') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_service_visit_work_order_insert
BEFORE INSERT ON service_visits
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM work_orders w
    WHERE w.tenant_id = NEW.tenant_id
      AND w.id = NEW.work_order_id
      AND w.deleted_at IS NULL
      AND w.status NOT IN ('completed', 'cancelled')
      AND w.technician_user_id = NEW.technician_user_id
  ) THEN RAISE(ABORT, 'FIELD_WORK_ORDER_INVALID') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_service_visit_schedule_insert
BEFORE INSERT ON service_visits
WHEN NEW.scheduled_end IS NOT NULL
BEGIN
  SELECT CASE WHEN julianday(NEW.scheduled_end) < julianday(NEW.scheduled_start)
    THEN RAISE(ABORT, 'FIELD_SCHEDULE_INVALID') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_service_visit_schedule_update
BEFORE UPDATE OF scheduled_start, scheduled_end ON service_visits
WHEN NEW.scheduled_end IS NOT NULL
BEGIN
  SELECT CASE WHEN julianday(NEW.scheduled_end) < julianday(NEW.scheduled_start)
    THEN RAISE(ABORT, 'FIELD_SCHEDULE_INVALID') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_service_visit_actual_time_update
BEFORE UPDATE OF arrival_at, departure_at ON service_visits
WHEN NEW.arrival_at IS NOT NULL AND NEW.departure_at IS NOT NULL
BEGIN
  SELECT CASE WHEN julianday(NEW.departure_at) < julianday(NEW.arrival_at)
    THEN RAISE(ABORT, 'FIELD_ACTUAL_TIME_INVALID') END;
END;

CREATE TRIGGER IF NOT EXISTS trg_service_visit_events_immutable_update
BEFORE UPDATE ON service_visit_events
BEGIN
  SELECT RAISE(ABORT, 'FIELD_EVENT_IMMUTABLE');
END;

CREATE TRIGGER IF NOT EXISTS trg_service_visit_events_immutable_delete
BEFORE DELETE ON service_visit_events
BEGIN
  SELECT RAISE(ABORT, 'FIELD_EVENT_IMMUTABLE');
END;

INSERT INTO schema_metadata (key, value, updated_at)
VALUES ('schema_version', '3', CURRENT_TIMESTAMP)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
