-- Tabela de setores personalizados por empresa
CREATE TABLE IF NOT EXISTS company_sectors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID REFERENCES companies(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT 'fi-rr-folder',
  color TEXT DEFAULT '#6b7280',
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(company_id, name)
);

-- Index para busca rápida por empresa
CREATE INDEX IF NOT EXISTS idx_company_sectors_company ON company_sectors(company_id, sort_order);

-- Trigger para atualizar updated_at na companies quando setores mudarem
CREATE OR REPLACE FUNCTION touch_company_on_sector_change()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE companies SET updated_at = now() WHERE id = COALESCE(NEW.company_id, OLD.company_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sector_touch_company ON company_sectors;
CREATE TRIGGER trg_sector_touch_company
  AFTER INSERT OR UPDATE OR DELETE ON company_sectors
  FOR EACH ROW EXECUTE FUNCTION touch_company_on_sector_change();
