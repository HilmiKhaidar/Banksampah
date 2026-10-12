USE bank_sampah;

RENAME TABLE
  accounts TO akun,
  sessions TO sesi,
  waste_types TO jenis_sampah,
  deposit_requests TO pengajuan_setoran,
  deposit_items TO rincian_setoran,
  deposit_photos TO foto_setoran,
  withdrawal_requests TO pengajuan_pencairan,
  wallet_entries TO transaksi_saldo,
  collection_schedules TO jadwal_pengumpulan,
  notifications TO notifikasi;

ALTER TABLE akun
  RENAME COLUMN role TO peran,
  RENAME COLUMN name TO nama,
  RENAME COLUMN identifier TO identitas,
  RENAME COLUMN class_name TO kelas,
  RENAME COLUMN password_hash TO hash_kata_sandi,
  RENAME COLUMN active TO aktif,
  RENAME COLUMN created_at TO dibuat_pada,
  RENAME COLUMN updated_at TO diperbarui_pada,
  RENAME INDEX identifier TO uq_akun_identitas,
  RENAME INDEX idx_accounts_role_active TO idx_akun_peran_aktif;

ALTER TABLE sesi
  RENAME COLUMN token_hash TO hash_token,
  RENAME COLUMN account_id TO akun_id,
  RENAME COLUMN expires_at TO kedaluwarsa_pada,
  RENAME COLUMN created_at TO dibuat_pada,
  RENAME INDEX idx_sessions_account_expiry TO idx_sesi_akun_kedaluwarsa,
  RENAME INDEX idx_sessions_expiry TO idx_sesi_kedaluwarsa;

ALTER TABLE jenis_sampah
  RENAME COLUMN name TO nama,
  RENAME COLUMN unit TO satuan,
  RENAME COLUMN price_per_unit TO harga_per_satuan,
  RENAME COLUMN icon TO ikon,
  RENAME COLUMN image_url TO url_gambar,
  RENAME COLUMN active TO aktif,
  RENAME COLUMN created_by TO dibuat_oleh,
  RENAME COLUMN created_at TO dibuat_pada,
  RENAME COLUMN updated_at TO diperbarui_pada,
  RENAME INDEX idx_waste_types_active_name TO idx_jenis_sampah_aktif_nama;

ALTER TABLE pengajuan_setoran
  RENAME COLUMN student_id TO peserta_id,
  RENAME COLUMN note TO catatan,
  RENAME COLUMN reviewed_by TO ditinjau_oleh,
  RENAME COLUMN reviewed_at TO ditinjau_pada,
  RENAME COLUMN created_at TO dibuat_pada,
  RENAME COLUMN updated_at TO diperbarui_pada,
  RENAME INDEX idx_deposit_requests_student_created TO idx_pengajuan_setoran_peserta_dibuat,
  RENAME INDEX idx_deposit_requests_status_created TO idx_pengajuan_setoran_status_dibuat;

ALTER TABLE rincian_setoran
  RENAME COLUMN deposit_id TO setoran_id,
  RENAME COLUMN waste_type_id TO jenis_sampah_id,
  RENAME COLUMN waste_type_name TO nama_jenis_sampah,
  RENAME COLUMN unit TO satuan,
  RENAME COLUMN quantity TO jumlah,
  RENAME COLUMN price_per_unit TO harga_per_satuan,
  RENAME COLUMN amount TO nominal,
  RENAME INDEX idx_deposit_items_deposit TO idx_rincian_setoran_setoran;

ALTER TABLE foto_setoran
  RENAME COLUMN deposit_id TO setoran_id,
  RENAME COLUMN image_url TO url_gambar,
  RENAME COLUMN created_at TO dibuat_pada,
  RENAME INDEX idx_deposit_photos_deposit TO idx_foto_setoran_setoran;

ALTER TABLE pengajuan_pencairan
  RENAME COLUMN student_id TO peserta_id,
  RENAME COLUMN amount TO nominal,
  RENAME COLUMN destination_type TO jenis_tujuan,
  RENAME COLUMN institution TO lembaga,
  RENAME COLUMN account_name TO nama_pemilik_rekening,
  RENAME COLUMN account_number TO nomor_rekening,
  RENAME COLUMN note TO catatan,
  RENAME COLUMN reviewed_by TO ditinjau_oleh,
  RENAME COLUMN reviewed_at TO ditinjau_pada,
  RENAME COLUMN paid_by TO dibayar_oleh,
  RENAME COLUMN paid_at TO dibayar_pada,
  RENAME COLUMN created_at TO dibuat_pada,
  RENAME COLUMN updated_at TO diperbarui_pada,
  RENAME INDEX idx_withdrawal_requests_student_created TO idx_pengajuan_pencairan_peserta_dibuat,
  RENAME INDEX idx_withdrawal_requests_status_created TO idx_pengajuan_pencairan_status_dibuat;

ALTER TABLE transaksi_saldo
  RENAME COLUMN student_id TO peserta_id,
  RENAME COLUMN kind TO jenis,
  RENAME COLUMN amount TO nominal,
  RENAME COLUMN description TO keterangan,
  RENAME COLUMN reference TO referensi,
  RENAME COLUMN deposit_id TO setoran_id,
  RENAME COLUMN withdrawal_request_id TO pengajuan_pencairan_id,
  RENAME COLUMN created_by TO dibuat_oleh,
  RENAME COLUMN created_at TO dibuat_pada,
  RENAME INDEX idx_wallet_entries_student_created TO idx_transaksi_saldo_peserta_dibuat,
  RENAME INDEX idx_wallet_entries_kind_created TO idx_transaksi_saldo_jenis_dibuat;

ALTER TABLE jadwal_pengumpulan
  DROP CHECK chk_collection_schedules_weekday,
  DROP CHECK chk_collection_schedules_time;

ALTER TABLE jadwal_pengumpulan
  RENAME COLUMN weekday TO hari,
  RENAME COLUMN start_time TO waktu_mulai,
  RENAME COLUMN end_time TO waktu_selesai,
  RENAME COLUMN location TO lokasi,
  RENAME COLUMN note TO catatan,
  RENAME COLUMN active TO aktif,
  RENAME COLUMN created_by TO dibuat_oleh,
  RENAME COLUMN created_at TO dibuat_pada,
  RENAME COLUMN updated_at TO diperbarui_pada,
  RENAME INDEX idx_collection_schedules_active_weekday_time TO idx_jadwal_pengumpulan_aktif_hari_waktu;

ALTER TABLE notifikasi
  RENAME COLUMN recipient_id TO penerima_id,
  RENAME COLUMN title TO judul,
  RENAME COLUMN message TO pesan,
  RENAME COLUMN kind TO jenis,
  RENAME COLUMN related_id TO id_terkait,
  RENAME COLUMN read_at TO dibaca_pada,
  RENAME COLUMN created_at TO dibuat_pada,
  RENAME INDEX idx_notifications_recipient_read_created TO idx_notifikasi_penerima_dibaca_dibuat;

ALTER TABLE akun
  MODIFY peran ENUM('manager', 'student', 'pengelola', 'peserta') NOT NULL;
UPDATE akun
  SET peran = CASE peran WHEN 'manager' THEN 'pengelola' ELSE 'peserta' END;
ALTER TABLE akun
  MODIFY peran ENUM('pengelola', 'peserta') NOT NULL;

ALTER TABLE pengajuan_setoran
  MODIFY status ENUM('pending', 'approved', 'rejected', 'cancelled',
    'menunggu', 'disetujui', 'ditolak', 'dibatalkan') NOT NULL DEFAULT 'pending';
UPDATE pengajuan_setoran
  SET status = CASE status
    WHEN 'pending' THEN 'menunggu'
    WHEN 'approved' THEN 'disetujui'
    WHEN 'rejected' THEN 'ditolak'
    WHEN 'cancelled' THEN 'dibatalkan'
    ELSE status
  END;
ALTER TABLE pengajuan_setoran
  MODIFY status ENUM('menunggu', 'disetujui', 'ditolak', 'dibatalkan')
    NOT NULL DEFAULT 'menunggu';

ALTER TABLE pengajuan_pencairan
  MODIFY jenis_tujuan ENUM('bank', 'ewallet', 'dompet_digital') NOT NULL,
  MODIFY status ENUM('pending', 'processing', 'paid', 'rejected', 'cancelled',
    'menunggu', 'diproses', 'dibayar', 'ditolak', 'dibatalkan') NOT NULL DEFAULT 'pending';
UPDATE pengajuan_pencairan
  SET jenis_tujuan = CASE jenis_tujuan
        WHEN 'ewallet' THEN 'dompet_digital'
        ELSE jenis_tujuan
      END,
      status = CASE status
        WHEN 'pending' THEN 'menunggu'
        WHEN 'processing' THEN 'diproses'
        WHEN 'paid' THEN 'dibayar'
        WHEN 'rejected' THEN 'ditolak'
        WHEN 'cancelled' THEN 'dibatalkan'
        ELSE status
      END;
ALTER TABLE pengajuan_pencairan
  MODIFY jenis_tujuan ENUM('bank', 'dompet_digital') NOT NULL,
  MODIFY status ENUM('menunggu', 'diproses', 'dibayar', 'ditolak', 'dibatalkan')
    NOT NULL DEFAULT 'menunggu';

ALTER TABLE transaksi_saldo
  MODIFY jenis ENUM('deposit', 'adjustment', 'withdrawal', 'redemption',
    'setoran', 'penyesuaian', 'pencairan', 'penukaran') NOT NULL;
UPDATE transaksi_saldo
  SET jenis = CASE jenis
    WHEN 'deposit' THEN 'setoran'
    WHEN 'adjustment' THEN 'penyesuaian'
    WHEN 'withdrawal' THEN 'pencairan'
    WHEN 'redemption' THEN 'penukaran'
    ELSE jenis
  END;
ALTER TABLE transaksi_saldo
  MODIFY jenis ENUM('setoran', 'penyesuaian', 'pencairan', 'penukaran') NOT NULL;

ALTER TABLE notifikasi
  MODIFY jenis ENUM('deposit', 'wallet', 'system', 'setoran', 'saldo', 'sistem') NOT NULL;
UPDATE notifikasi
  SET jenis = CASE jenis
    WHEN 'deposit' THEN 'setoran'
    WHEN 'wallet' THEN 'saldo'
    WHEN 'system' THEN 'sistem'
    ELSE jenis
  END;
ALTER TABLE notifikasi
  MODIFY jenis ENUM('setoran', 'saldo', 'sistem') NOT NULL;

ALTER TABLE sesi
  DROP FOREIGN KEY fk_sessions_account,
  ADD CONSTRAINT fk_sesi_akun FOREIGN KEY (akun_id)
    REFERENCES akun(id) ON DELETE CASCADE;

ALTER TABLE jenis_sampah
  DROP FOREIGN KEY fk_waste_types_created_by,
  DROP INDEX fk_waste_types_created_by,
  ADD CONSTRAINT fk_jenis_sampah_pembuat FOREIGN KEY (dibuat_oleh)
    REFERENCES akun(id);

ALTER TABLE pengajuan_setoran
  DROP FOREIGN KEY fk_deposit_requests_student,
  DROP FOREIGN KEY fk_deposit_requests_reviewer,
  DROP INDEX fk_deposit_requests_reviewer,
  ADD CONSTRAINT fk_pengajuan_setoran_peserta FOREIGN KEY (peserta_id)
    REFERENCES akun(id),
  ADD CONSTRAINT fk_pengajuan_setoran_peninjau FOREIGN KEY (ditinjau_oleh)
    REFERENCES akun(id);

ALTER TABLE rincian_setoran
  DROP FOREIGN KEY fk_deposit_items_request,
  DROP FOREIGN KEY fk_deposit_items_waste_type,
  DROP INDEX fk_deposit_items_waste_type,
  ADD CONSTRAINT fk_rincian_setoran_pengajuan FOREIGN KEY (setoran_id)
    REFERENCES pengajuan_setoran(id) ON DELETE CASCADE,
  ADD CONSTRAINT fk_rincian_setoran_jenis_sampah FOREIGN KEY (jenis_sampah_id)
    REFERENCES jenis_sampah(id) ON DELETE SET NULL;

ALTER TABLE foto_setoran
  DROP FOREIGN KEY fk_deposit_photos_request,
  ADD CONSTRAINT fk_foto_setoran_pengajuan FOREIGN KEY (setoran_id)
    REFERENCES pengajuan_setoran(id) ON DELETE CASCADE;

ALTER TABLE pengajuan_pencairan
  DROP FOREIGN KEY fk_withdrawal_requests_student,
  DROP FOREIGN KEY fk_withdrawal_requests_reviewer,
  DROP INDEX fk_withdrawal_requests_reviewer,
  DROP FOREIGN KEY fk_withdrawal_requests_paid_by,
  DROP INDEX fk_withdrawal_requests_paid_by,
  ADD CONSTRAINT fk_pengajuan_pencairan_peserta FOREIGN KEY (peserta_id)
    REFERENCES akun(id),
  ADD CONSTRAINT fk_pengajuan_pencairan_peninjau FOREIGN KEY (ditinjau_oleh)
    REFERENCES akun(id),
  ADD CONSTRAINT fk_pengajuan_pencairan_pembayar FOREIGN KEY (dibayar_oleh)
    REFERENCES akun(id);

ALTER TABLE transaksi_saldo
  DROP FOREIGN KEY fk_wallet_entries_student,
  DROP FOREIGN KEY fk_wallet_entries_deposit,
  DROP INDEX fk_wallet_entries_deposit,
  DROP FOREIGN KEY fk_wallet_entries_withdrawal,
  DROP INDEX fk_wallet_entries_withdrawal,
  DROP FOREIGN KEY fk_wallet_entries_created_by,
  DROP INDEX fk_wallet_entries_created_by,
  ADD CONSTRAINT fk_transaksi_saldo_peserta FOREIGN KEY (peserta_id)
    REFERENCES akun(id),
  ADD CONSTRAINT fk_transaksi_saldo_setoran FOREIGN KEY (setoran_id)
    REFERENCES pengajuan_setoran(id),
  ADD CONSTRAINT fk_transaksi_saldo_pencairan FOREIGN KEY (pengajuan_pencairan_id)
    REFERENCES pengajuan_pencairan(id),
  ADD CONSTRAINT fk_transaksi_saldo_pembuat FOREIGN KEY (dibuat_oleh)
    REFERENCES akun(id);

ALTER TABLE jadwal_pengumpulan
  DROP FOREIGN KEY fk_collection_schedules_created_by,
  DROP INDEX fk_collection_schedules_created_by,
  ADD CONSTRAINT chk_jadwal_pengumpulan_hari CHECK (hari BETWEEN 1 AND 7),
  ADD CONSTRAINT chk_jadwal_pengumpulan_waktu CHECK (waktu_selesai > waktu_mulai),
  ADD CONSTRAINT fk_jadwal_pengumpulan_pembuat FOREIGN KEY (dibuat_oleh)
    REFERENCES akun(id);

ALTER TABLE notifikasi
  DROP FOREIGN KEY fk_notifications_recipient,
  ADD CONSTRAINT fk_notifikasi_penerima FOREIGN KEY (penerima_id)
    REFERENCES akun(id) ON DELETE CASCADE;
