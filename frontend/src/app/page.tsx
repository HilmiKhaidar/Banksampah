"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import styles from "./page.module.css";
import { ApiError, apiRequest, notifyAuthChanged, AUTH_SYNC_CHANNEL } from "@/lib/api";
import {
  AccountProfile,
  LocalAccount,
  cacheServerAccount,
  clearLegacyLocalAuthData,
} from "@/lib/local-auth";
import Workspace from "@/features/workspace/Workspace";

type AuthMode = "login" | "manager-setup";

function BrandMark() {
  return (
    <span className={styles.brandMark} aria-hidden="true">
      <svg viewBox="0 0 32 32" fill="none">
        <path
          d="M25.7 6.3C17.4 6.4 9.2 8 7 14.8c-1.1 3.4.8 6.6 4 7.2 6.5 1.2 11.8-5.8 14.7-15.7Z"
          fill="currentColor"
        />
        <path d="M7 26c2.2-6.4 6-10.1 12.1-13.5" stroke="white" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </span>
  );
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Terjadi kesalahan. Silakan coba lagi.";
}

function RequiredPasswordChange({
  account,
  onComplete,
  onLogout,
}: {
  account: LocalAccount;
  onComplete: (account: LocalAccount) => void;
  onLogout: () => Promise<void>;
}) {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      setMessage("Konfirmasi kata sandi belum cocok.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      await apiRequest("/api/auth/password", {
        method: "PUT",
        body: { newPassword },
      });
      onComplete(cacheServerAccount({ ...account, passwordChangeRequired: false }));
      notifyAuthChanged();
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.authPage}>
      <section className={styles.authSide}>
        <div className={styles.authCard}>
          <p className={styles.eyebrow}>KEAMANAN AKUN</p>
          <h2>Ganti kata sandi sementara</h2>
          <p className={styles.authDescription}>
            Buat kata sandi baru sebelum melanjutkan menggunakan aplikasi.
          </p>
          <form className={styles.authForm} onSubmit={handleSubmit}>
            <label>
              Kata sandi baru
              <input
                autoComplete="new-password"
                minLength={8}
                onChange={(event) => setNewPassword(event.target.value)}
                required
                type="password"
                value={newPassword}
              />
            </label>
            <label>
              Ulangi kata sandi baru
              <input
                autoComplete="new-password"
                minLength={8}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
                type="password"
                value={confirmPassword}
              />
            </label>
            {message && <p className={styles.formMessage} role="alert">{message}</p>}
            <button className={styles.submitButton} disabled={busy} type="submit">
              {busy ? "Menyimpan..." : "Simpan kata sandi"}
            </button>
            <button className={styles.setupLink} onClick={() => void onLogout()} type="button">
              Keluar
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}

export default function Home() {
  const [mode, setMode] = useState<AuthMode>("login");
  const [account, setAccount] = useState<LocalAccount | null>(null);
  const [managerSetupAvailable, setManagerSetupAvailable] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [name, setName] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [managerSetupKey, setManagerSetupKey] = useState("");

  const refreshAccount = useCallback(async (showExpiredMessage = false) => {
    try {
      const result = await apiRequest<{ account: AccountProfile }>(
        "/api/auth/session",
      );
      setAccount(cacheServerAccount(result.account));
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setAccount(null);
        if (showExpiredMessage && account) {
          setIdentifier("");
          setPassword("");
          setMode("login");
          setMessage("Sesi berakhir atau akun tidak lagi aktif. Silakan masuk kembali.");
        }
        return;
      }
      setMessage(getErrorMessage(error));
    }
  }, [account]);

  const refreshManagerSetup = useCallback(async () => {
    try {
      const result = await apiRequest<{ managerSetupAvailable: boolean }>("/api/auth/setup");
      setManagerSetupAvailable(result.managerSetupAvailable);
    } catch (error) {
      setMessage(getErrorMessage(error));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function initialize() {
      let initializationError: unknown = null;
      try {
        clearLegacyLocalAuthData();
      } catch (error) {
        initializationError = error;
      }
      const [session, setup] = await Promise.allSettled([
        apiRequest<{ account: AccountProfile }>("/api/auth/session"),
        apiRequest<{ managerSetupAvailable: boolean }>("/api/auth/setup"),
      ]);
      if (cancelled) return;

      if (session.status === "fulfilled") {
        setAccount(cacheServerAccount(session.value.account));
      } else if (!(session.reason instanceof ApiError && session.reason.status === 401)) {
        initializationError = session.reason;
      }
      if (setup.status === "fulfilled") {
        setManagerSetupAvailable(setup.value.managerSetupAvailable);
      } else if (!initializationError) {
        initializationError = setup.reason;
      }
      if (initializationError) setMessage(getErrorMessage(initializationError));
      setReady(true);
    }
    void initialize();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const authChannel = new BroadcastChannel(AUTH_SYNC_CHANNEL);
    function handleAuthChange() {
      void refreshAccount(true);
      void refreshManagerSetup();
    }
    function handleFocus() {
      void refreshAccount(true);
      void refreshManagerSetup();
    }

    authChannel.addEventListener("message", handleAuthChange);
    window.addEventListener("focus", handleFocus);
    return () => {
      authChannel.removeEventListener("message", handleAuthChange);
      authChannel.close();
      window.removeEventListener("focus", handleFocus);
    };
  }, [refreshAccount, refreshManagerSetup]);

  function changeMode(nextMode: AuthMode) {
    setMode(nextMode);
    setMessage("");
    if (nextMode !== "manager-setup") setManagerSetupKey("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");

    try {
      let authenticatedAccount: AccountProfile;
      if (mode === "login") {
        const result = await apiRequest<{ account: AccountProfile }>(
          "/api/auth/login",
          { method: "POST", body: { identifier, password } },
        );
        authenticatedAccount = result.account;
      } else {
        if (password.length < 8) {
          setMessage("Kata sandi harus terdiri dari minimal 8 karakter.");
          return;
        }
        if (password !== confirmPassword) {
          setMessage("Konfirmasi kata sandi belum cocok.");
          return;
        }

        const result = await apiRequest<{ account: AccountProfile }>("/api/auth/setup-manager", {
          method: "POST",
          headers: { "x-manager-setup-key": managerSetupKey },
          body: { name, identifier, whatsapp, password },
        });
        authenticatedAccount = result.account;
        setManagerSetupAvailable(false);
      }

      setAccount(cacheServerAccount(authenticatedAccount));
      notifyAuthChanged();
      setPassword("");
      setConfirmPassword("");
      setManagerSetupKey("");
    } catch (error) {
      setMessage(getErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    try {
      await apiRequest<{ message: string }>("/api/auth/logout", { method: "POST" });
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) throw error;
    }
    setAccount(null);
    setIdentifier("");
    setPassword("");
    setMessage("");
    setMode("login");
    notifyAuthChanged();
  }

  if (!ready) {
    return (
      <main className={styles.loading}>
        <BrandMark />
        <p>Menyiapkan ruang Bank Sampah...</p>
      </main>
    );
  }

  if (account) {
    if (account.passwordChangeRequired) {
      return (
        <RequiredPasswordChange
          account={account}
          onComplete={setAccount}
          onLogout={handleLogout}
        />
      );
    }
    return (
      <Workspace
        account={account}
        onAccountChange={setAccount}
        onLogout={handleLogout}
      />
    );
  }

  const isLogin = mode === "login";
  const isManagerSetup = mode === "manager-setup";

  return (
    <main className={styles.authPage}>
      <section className={styles.authIntro}>
        <Link className={styles.brand} href="/" aria-label="Bank Sampah Sekolah Merdeka">
          <BrandMark />
          <span>
            <strong>Bank Sampah</strong>
            <small>Sekolah Merdeka</small>
          </span>
        </Link>
        <div className={styles.introCopy}>
          <div className={styles.introPill}>
            <span /> Langkah kecil, dampak berarti
          </div>
          <h1>Setoranmu punya nilai lebih.</h1>
          <p>
            Satu ruang sederhana untuk mencatat setoran sampah, mengumpulkan poin, dan menukarnya
            dengan reward sambil menjaga lingkungan sekolah.
          </p>
          <div className={styles.introFoot}>
            <span className={styles.leafDecoration} aria-hidden="true">✳</span>
            <span>Program Bank Sampah<br />Sekolah Merdeka</span>
          </div>
        </div>
        <span className={styles.introCopyright}>Bank Sampah · Sekolah Merdeka</span>
      </section>

      <section className={styles.authSide}>
        <div className={styles.authCard}>
          <p className={styles.eyebrow}>
            {isManagerSetup ? "PENGATURAN AWAL" : "SELAMAT DATANG KEMBALI"}
          </p>
          <h2>
            {isManagerSetup ? "Buat akun pengelola" : "Masuk ke akunmu"}
          </h2>
          <p className={styles.authDescription}>
            {isManagerSetup
              ? "Buat akun pengelola pertama dengan kunci setup dari server."
              : "Peserta masuk dengan NISN; pengelola masuk dengan nama pengguna. Gunakan kata sandi dari pengelola sekolah."}
          </p>

          <form className={styles.authForm} onSubmit={handleSubmit}>
            {!isLogin && (
              <>
                <label>
                  Nama lengkap
                  <input
                    autoComplete="name"
                    maxLength={100}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Masukkan nama lengkap"
                    required
                    value={name}
                  />
                </label>
                <label>
                  Nama pengguna
                  <input
                    autoComplete="username"
                    maxLength={40}
                    onChange={(event) => setIdentifier(event.target.value)}
                    placeholder="Buat nama pengguna"
                    required
                    value={identifier}
                  />
                </label>
                <label>
                  Nomor WhatsApp
                  <input
                    autoComplete="tel"
                    maxLength={24}
                    onChange={(event) => setWhatsapp(event.target.value)}
                    placeholder="Contoh: 08xxxxxxxxxx"
                    required
                    type="tel"
                    value={whatsapp}
                  />
                </label>
              </>
            )}

            {isManagerSetup && (
              <label>
                Kunci setup pengelola
                <input
                  autoComplete="off"
                  onChange={(event) => setManagerSetupKey(event.target.value)}
                  placeholder="Masukkan kunci dari konfigurasi server"
                  required
                  type="password"
                  value={managerSetupKey}
                />
              </label>
            )}

            {isLogin && (
              <label>
                NISN atau nama pengguna
                <input
                  autoComplete="username"
                  onChange={(event) => setIdentifier(event.target.value)}
                  placeholder="Masukkan NISN atau nama pengguna"
                  required
                  value={identifier}
                />
              </label>
            )}
            <label>
              Kata sandi
              <input
                autoComplete={isLogin ? "current-password" : "new-password"}
                minLength={8}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={isLogin ? "Masukkan kata sandi" : "Minimal 8 karakter"}
                required
                type="password"
                value={password}
              />
            </label>
            {isManagerSetup && (
              <label>
                Ulangi kata sandi
                <input
                  autoComplete="new-password"
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="Masukkan kembali kata sandi"
                  required
                  type="password"
                  value={confirmPassword}
                />
              </label>
            )}

            {message && (
              <p className={styles.formMessage} role="alert">
                {message}
              </p>
            )}

            <button className={styles.submitButton} disabled={busy} type="submit">
              {busy
                ? "Memproses..."
                : isManagerSetup
                  ? "Buat akun pengelola"
                  : "Masuk"}
              {!busy && <span aria-hidden="true">→</span>}
            </button>
          </form>

          <div className={styles.authSwitch}>
            {isManagerSetup && (
              <>
                <span>Sudah punya akun?</span>
                <button onClick={() => changeMode("login")} type="button">
                  Masuk
                </button>
              </>
            )}
          </div>

          {isLogin && managerSetupAvailable && (
            <button
              className={styles.setupLink}
              onClick={() => changeMode("manager-setup")}
              type="button"
            >
              Pengelola baru? Buat akun pengelola pertama
            </button>
          )}

          <p className={styles.localNotice}>
            Akun peserta disiapkan oleh pengelola menggunakan data sekolah. Jika belum memiliki akun, hubungi pengelola.
          </p>
        </div>
        <footer className={styles.authFooter}>© Sekolah Merdeka · Bank Sampah</footer>
      </section>
    </main>
  );
}
