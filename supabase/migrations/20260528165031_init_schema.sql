CREATE TABLE keuanganku_sync (
  sync_code TEXT PRIMARY KEY,
  state_data JSONB NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);
