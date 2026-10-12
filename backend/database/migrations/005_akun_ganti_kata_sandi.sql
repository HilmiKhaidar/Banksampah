ALTER TABLE akun
  ADD COLUMN wajib_ganti_kata_sandi BOOLEAN NOT NULL DEFAULT FALSE
  AFTER hash_kata_sandi;
