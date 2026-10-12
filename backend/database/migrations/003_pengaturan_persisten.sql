USE bank_sampah;

ALTER TABLE akun
  ADD COLUMN notifikasi_dalam_aplikasi BOOLEAN NOT NULL DEFAULT TRUE
  AFTER whatsapp;
