USE bank_sampah;

CREATE TABLE IF NOT EXISTS pengaturan_bank_sampah (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  rupiah_per_poin BIGINT UNSIGNED NULL,
  diperbarui_oleh CHAR(36) NULL,
  diperbarui_pada TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ON UPDATE CURRENT_TIMESTAMP(3),
  CONSTRAINT chk_pengaturan_bank_sampah_tunggal CHECK (id = 1),
  CONSTRAINT chk_pengaturan_rupiah_per_poin CHECK (rupiah_per_poin IS NULL OR rupiah_per_poin > 0),
  CONSTRAINT fk_pengaturan_bank_sampah_pengelola FOREIGN KEY (diperbarui_oleh)
    REFERENCES akun(id)
) ENGINE=InnoDB;

INSERT IGNORE INTO pengaturan_bank_sampah (id, rupiah_per_poin) VALUES (1, NULL);
