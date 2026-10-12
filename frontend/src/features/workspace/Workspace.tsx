"use client";

import { ChangeEvent, FormEvent, type CSSProperties, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  DataTable,
  EmptyState,
  SectionTitle,
} from "@/components/ui/WorkspacePrimitives";
import NotificationList from "@/features/notifications/NotificationList";
import RewardCenter from "@/features/rewards/RewardCenter";
import MonthlyRanking from "@/features/ranking/MonthlyRanking";
import {
  cacheServerAccount,
  cacheServerAccounts,
  getLocalAccounts,
  LocalAccount,
} from "@/lib/local-auth";
import { apiRequest, apiUrl, notifyAuthChanged } from "@/lib/api";
import { parseStudentImportFile, StudentImportRow } from "@/lib/student-import";
import { clearLegacyBusinessCache } from "@/lib/legacy-storage";
import {
  BusinessData,
  BusinessNotification,
  BusinessSettings,
  DepositRequest,
  formatRupiah,
  getStudentAvailableBalance,
  getStudentBalance,
  getStudentPoints,
  getStudentAvailablePoints,
  getPointsRupiahValue,
  HistoricalWasteUnit,
  PointEntry,
  maskAccountNumber,
  WasteType,
  WasteUnit,
  WithdrawalRequest,
} from "@/lib/business-data";
import styles from "./Workspace.module.css";

type ManagerView = "overview" | "deposits" | "students" | "waste" | "transactions" | "withdrawals" | "notifications";
type StudentCredential = {
  name: string;
  identifier: string;
  temporaryPassword: string;
};
type StudentView = "overview" | "deposits" | "balance" | "withdrawals" | "ranking" | "notifications";
type View =
  | ManagerView
  | StudentView
  | "profile"
  | "profile-details"
  | "security"
  | "preferences"
  | "settings"
  | "conversion"
  | "contact"
  | "help";

const viewNames: Record<View, string> = {
  overview: "Ringkasan",
  deposits: "Pengajuan setoran",
  students: "Peserta",
  waste: "Jenis & tarif poin",
  transactions: "Katalog reward",
  withdrawals: "Penukaran reward",
  ranking: "Ranking bulanan",
  balance: "Poin & riwayat",
  notifications: "Notifikasi",
  profile: "Profil",
  "profile-details": "Data akun",
  security: "Keamanan",
  preferences: "Preferensi notifikasi",
  settings: "Pengaturan",
  conversion: "Nilai konversi poin",
  contact: "Kontak pengelola",
  help: "Bantuan & informasi",
};

const wasteIcons = [
  { icon: "♻️", name: "Sampah daur ulang" },
  { icon: "🥤", name: "Gelas plastik" },
  { icon: "🥫", name: "Kaleng" },
  { icon: "🍾", name: "Botol kaca" },
  { icon: "📄", name: "Kertas" },
  { icon: "📦", name: "Kardus" },
  { icon: "🔋", name: "Baterai" },
  { icon: "👕", name: "Pakaian" },
  { icon: "🍃", name: "Sampah organik" },
  { icon: "🧴", name: "Botol plastik" },
];

function suggestWasteIcon(name: string) {
  const normalized = name.toLocaleLowerCase("id-ID");
  if (/botol plastik|plastik/.test(normalized)) return "🧴";
  if (/gelas|cup/.test(normalized)) return "🥤";
  if (/kaleng|aluminium|besi|logam/.test(normalized)) return "🥫";
  if (/botol kaca|kaca/.test(normalized)) return "🍾";
  if (/botol/.test(normalized)) return "🧴";
  if (/kertas|kardus|karton/.test(normalized)) return "📄";
  if (/baterai|aki|elektronik/.test(normalized)) return "🔋";
  if (/baju|tekstil|kain/.test(normalized)) return "👕";
  if (/daun|organik/.test(normalized)) return "🍃";
  return "♻️";
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function statusName(status: DepositRequest["status"]) {
  return {
    pending: "Menunggu",
    approved: "Disetujui",
    rejected: "Ditolak",
    cancelled: "Dibatalkan",
  }[status];
}

function entryName(kind: "deposit" | "adjustment" | "withdrawal" | "redemption") {
  return {
    deposit: "Setoran",
    adjustment: "Koreksi saldo",
    withdrawal: "Pencairan tunai",
    redemption: "Penukaran reward",
  }[kind];
}

function wasteUnitLabel(unit: HistoricalWasteUnit) {
  return unit;
}

function getMessage(error: unknown) {
  return error instanceof Error ? error.message : "Terjadi kesalahan. Silakan coba lagi.";
}

function whatsappUrl(numberValue: string, message: string) {
  const number = numberValue.replace(/\D/g, "").replace(/^0/, "62");
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

async function compressPhoto(file: File) {
  if (!file.type.startsWith("image/")) {
    throw new Error(`${file.name}: berkas harus berupa gambar.`);
  }
  if (file.size > 12 * 1024 * 1024) {
    throw new Error(`${file.name}: ukuran foto maksimal 12 MB sebelum dikompres.`);
  }
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1000 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Browser tidak dapat memproses foto ini.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.72),
    );
    if (!blob) throw new Error("Foto gagal dikompres.");
    if (blob.size > 450 * 1024) throw new Error(`${file.name}: hasil foto terlalu besar.`);
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error(`${file.name}: foto gagal dibaca.`));
      reader.onload = () =>
        typeof reader.result === "string"
          ? resolve(reader.result)
          : reject(new Error(`${file.name}: format foto tidak valid.`));
      reader.readAsDataURL(blob);
    });
  } finally {
    bitmap.close();
  }
}

export default function Workspace({
  account,
  onAccountChange,
  onLogout,
}: {
  account: LocalAccount;
  onAccountChange: (account: LocalAccount) => void;
  onLogout: () => Promise<void>;
}) {
  const isManager = account.role === "manager";
  const [view, setView] = useState<View>("overview");
  const [data, setData] = useState<BusinessData>({
    wasteTypes: [],
    deposits: [],
    walletEntries: [],
    pointEntries: [],
    rewards: [],
    redemptionRequests: [],
    notifications: [],
    withdrawalRequests: [],
  });
  const [students, setStudents] = useState<LocalAccount[]>([]);
  const [managerWhatsapp, setManagerWhatsapp] = useState("");
  const [settings, setSettings] = useState<BusinessSettings>({
    managerWhatsapp: "",
    inAppNotifications: true,
    rupiahPerPoint: null,
  });
  const [ready, setReady] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [viewportSize, setViewportSize] = useState({
    width: 0,
    viewportWidth: 0,
    anchorX: 0,
    anchorY: 0,
    navTop: 0,
  });
  const updateViewportSize = useCallback(() => {
    const nav = document.querySelector("nav[aria-label='Navigasi bawah']");
    const navRect = nav?.getBoundingClientRect();
    const triggerRect = nav?.querySelector("button[aria-label='Lainnya']")?.getBoundingClientRect();
    const closeButtonSize = Math.min(Math.max(58, window.innerWidth * 0.16), 72);
    const anchorY = navRect
      ? navRect.top - closeButtonSize / 2 - 16
      : window.innerHeight - closeButtonSize / 2 - 91;
    setViewportSize({
      width: document.documentElement.clientWidth,
      viewportWidth: window.innerWidth,
      anchorX: triggerRect ? triggerRect.left + triggerRect.width / 2 : window.innerWidth / 2,
      anchorY,
      navTop: navRect?.top ?? window.innerHeight - 75,
    });
  }, []);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [search, setSearch] = useState("");
  const [depositFilter, setDepositFilter] = useState("pending");
  const [selectedDepositId, setSelectedDepositId] = useState("");
  const [editingType, setEditingType] = useState<WasteType | null>(null);
  const [wasteName, setWasteName] = useState("");
  const [wastePrice, setWastePrice] = useState("");
  const [wasteUnit, setWasteUnit] = useState<WasteUnit>("kg");
  const [wasteIcon, setWasteIcon] = useState("♻️");
  const [wasteImage, setWasteImage] = useState<string | null>(null);
  const [wasteVisualMode, setWasteVisualMode] = useState<"icon" | "photo">("icon");
  const [studentEditId, setStudentEditId] = useState("");
  const [studentDetailId, setStudentDetailId] = useState("");
  const [studentName, setStudentName] = useState("");
  const [studentClass, setStudentClass] = useState("");
  const [studentWhatsapp, setStudentWhatsapp] = useState("");
  const [studentActive, setStudentActive] = useState(true);
  const [importingStudents, setImportingStudents] = useState(false);
  const [importedCredentials, setImportedCredentials] = useState<StudentCredential[]>([]);
  const [reviewTypes, setReviewTypes] = useState<Record<string, string>>({});
  const [reviewWeights, setReviewWeights] = useState<Record<string, string>>({});
  const [reviewNote, setReviewNote] = useState("");
  const [decisionPending, setDecisionPending] = useState(false);
  const [studentWasteIds, setStudentWasteIds] = useState<string[]>([]);
  const [studentPhotos, setStudentPhotos] = useState<string[]>([]);
  const [photoNames, setPhotoNames] = useState<string[]>([]);
  const [depositBusy, setDepositBusy] = useState(false);

  function refreshData() {
    const accounts = getLocalAccounts();
    setStudents(accounts.filter((item) => item.role === "student"));
  }

  async function refreshBusinessData() {
    const businessData = await apiRequest<
      Pick<
        BusinessData,
        "wasteTypes" | "deposits" | "pointEntries" | "rewards" | "redemptionRequests" | "notifications"
      > & { preferences: BusinessSettings }
    >("/api/business/data");
    setData((current) => ({
      ...current,
      ...businessData,
      wasteTypes: businessData.wasteTypes.map((wasteType) => ({
        ...wasteType,
        image: wasteType.image?.startsWith("/api/")
          ? apiUrl(wasteType.image)
          : wasteType.image,
      })),
      deposits: businessData.deposits.map((deposit) => ({
        ...deposit,
      })),
    }));
    setSettings(businessData.preferences);
    setManagerWhatsapp(businessData.preferences.managerWhatsapp);
    try {
      clearLegacyBusinessCache();
    } catch (cleanupError) {
      setError(`Data server berhasil dimuat, tetapi cache lama browser gagal dibersihkan: ${getMessage(cleanupError)}`);
    }
  }

  async function refreshServerStudents() {
    const result = await apiRequest<{ students: Omit<LocalAccount, "salt" | "passwordHash">[] }>(
      "/api/auth/students",
    );
    cacheServerAccounts(result.students);
    setStudents(getLocalAccounts().filter((item) => item.role === "student"));
  }

  useEffect(() => {
    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      try {
        refreshData();
        void (async () => {
          try {
            await Promise.all([
              refreshBusinessData(),
              isManager ? refreshServerStudents() : Promise.resolve(),
            ]);
          } catch (loadError) {
            if (!cancelled) setError(getMessage(loadError));
          } finally {
            if (!cancelled) setReady(true);
          }
        })();
      } catch (loadError) {
        setError(getMessage(loadError));
        setReady(true);
      }
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [isManager]);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(updateViewportSize);
    window.addEventListener("resize", updateViewportSize);
    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", updateViewportSize);
    };
  }, [updateViewportSize]);

  useEffect(() => {
    if (!success) return;
    const timeoutId = window.setTimeout(() => setSuccess(""), 3500);
    return () => window.clearTimeout(timeoutId);
  }, [success]);

  async function runBusinessAction(action: () => Promise<void>, successMessage: string) {
    setError("");
    setSuccess("");
    try {
      await action();
      await refreshBusinessData();
      refreshData();
      setSuccess(successMessage);
      return true;
    } catch (actionError) {
      setError(getMessage(actionError));
      return false;
    }
  }

  async function handleLogout() {
    setError("");
    try {
      await onLogout();
    } catch (logoutError) {
      setError(getMessage(logoutError));
    }
  }

  function closeMoreMenu() {
    setMoreOpen(false);
  }

  function toggleMoreMenu() {
    if (moreOpen) {
      closeMoreMenu();
      return;
    }

    updateViewportSize();
    setMoreOpen(true);
  }

  const myNotifications = data.notifications
    .filter((notification) => notification.recipientId === account.id)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const unreadCount = myNotifications.filter((notification) => !notification.readAt).length;
  const managerNav: ManagerView[] = [
    "overview",
    "deposits",
    "students",
    "waste",
    "transactions",
    "withdrawals",
    "notifications",
  ];
  const studentNav: StudentView[] = ["overview", "deposits", "balance", "withdrawals", "ranking", "notifications"];
  const navItems: View[] = isManager ? managerNav : studentNav;
  const mobilePrimaryNav: View[] = isManager
    ? ["overview", "students"]
    : ["overview", "ranking"];
  const mobileOverflowNav: View[] = isManager
    ? ["deposits", "waste", "transactions", "withdrawals"]
    : ["deposits", "balance", "withdrawals"];
  const mobileNavItems: View[] = mobilePrimaryNav;
  const radialViewportWidth = viewportSize.viewportWidth || 320;
  const radialLayoutWidth = viewportSize.width || radialViewportWidth;
  const mobileOverflowAngles = isManager ? [126, 54, 162, 18] : [126, 54, 162];
  const radialGap = radialViewportWidth <= 340 ? 12 : 8;
  const outerVerticalFactor = Math.sin(120 * Math.PI / 180) - Math.sin(170 * Math.PI / 180);
  const middleHorizontalFactor = Math.cos(60 * Math.PI / 180) - Math.cos(120 * Math.PI / 180);
  const sideRoom = Math.min(viewportSize.anchorX, radialLayoutWidth - viewportSize.anchorX) - 6;
  const radialBaseCardWidth = Math.min(radialLayoutWidth * 0.28, 120);
  const radialBaseCardHeight = Math.min(radialViewportWidth * 0.25, 96);
  const tiltRadians = 0;
  const rotationWidthFactor = Math.cos(tiltRadians) + (radialBaseCardHeight / radialBaseCardWidth) * Math.sin(tiltRadians);
  const rotationHeightFactor = Math.cos(tiltRadians) + (radialBaseCardWidth / radialBaseCardHeight) * Math.sin(tiltRadians);
  const boundHeightPerCardWidth = rotationHeightFactor * radialBaseCardHeight / radialBaseCardWidth;
  const radialWidthLimit = Math.min(
    (middleHorizontalFactor * sideRoom / Math.cos(10 * Math.PI / 180) - radialGap) /
      (rotationWidthFactor * (1 + middleHorizontalFactor / (2 * Math.cos(10 * Math.PI / 180)))),
    (sideRoom / Math.cos(10 * Math.PI / 180) - radialGap / outerVerticalFactor) /
      (boundHeightPerCardWidth / outerVerticalFactor + rotationWidthFactor / (2 * Math.cos(10 * Math.PI / 180))),
  );
  const radialCardWidth = Math.max(
    radialViewportWidth <= 340 ? 60 : 64,
    Math.min(radialBaseCardWidth, radialWidthLimit),
  );
  const radialCardHeight = Math.min(radialBaseCardHeight, radialCardWidth * radialBaseCardHeight / radialBaseCardWidth);
  const radialCardWidthBound = radialCardWidth * rotationWidthFactor;
  const radialCardHeightBound = radialCardHeight * rotationHeightFactor;
  const radialMaximumHorizontalRadius =
    (sideRoom - radialCardWidthBound / 2 - 10) / Math.cos(10 * Math.PI / 180);
  const radialMinimumRadius = Math.max(
    (radialCardWidthBound + radialGap) / middleHorizontalFactor,
    (radialCardHeightBound + radialGap) / outerVerticalFactor,
  );
  const radialMaximumVerticalRadius =
    (viewportSize.anchorY - 72 - radialCardHeightBound / 2) / Math.sin(120 * Math.PI / 180);
  const radialRadius = Math.min(radialMinimumRadius, radialMaximumHorizontalRadius, radialMaximumVerticalRadius);
  const pendingDeposits = data.deposits.filter((item) => item.status === "pending");
  const allBalance = students.reduce(
    (total, student) => total + getStudentPoints(data, student.id),
    0,
  );
  const myBalance = getStudentPoints(data, account.id);
  const myAvailablePoints = getStudentAvailablePoints(data, account.id);
  const myDeposits = data.deposits
    .filter((deposit) => deposit.studentId === account.id)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const recentTransactions = [...data.pointEntries]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 6);
  const filteredStudents = students.filter((student) => {
    const query = search.trim().toLowerCase();
    return (
      !query ||
      student.name.toLowerCase().includes(query) ||
      student.identifier.toLowerCase().includes(query) ||
      (student.className ?? "").toLowerCase().includes(query)
    );
  });
  const selectedDeposit = data.deposits.find((deposit) => deposit.id === selectedDepositId);
  const activeWasteTypes = data.wasteTypes.filter(
    (item) => item.active && item.pointsPerUnit > 0,
  );

  function startEditStudent(student: LocalAccount) {
    setStudentEditId(student.id);
    setStudentName(student.name);
    setStudentClass(student.className ?? "");
    setStudentWhatsapp(student.whatsapp);
    setStudentActive(student.active !== false);
  }

  function startEditWasteType(item: WasteType) {
    if (item.unit === "buah") {
      setError("Jenis sampah lama dengan satuan PCS tidak dapat diedit atau diaktifkan kembali.");
      return;
    }
    setEditingType(item);
    setWasteName(item.name);
    setWastePrice(String(item.pointsPerUnit));
    setWasteUnit(item.unit);
    setWasteIcon(item.icon ?? suggestWasteIcon(item.name));
    setWasteImage(item.image ?? null);
    setWasteVisualMode(item.image ? "photo" : "icon");
  }

  async function openDeposit(deposit: DepositRequest) {
    setSelectedDepositId(deposit.id);
    setReviewTypes(Object.fromEntries(deposit.lines.map((line) => [line.wasteTypeId, line.wasteTypeId])));
    setReviewWeights({});
    setReviewNote("");
    setError("");
    try {
      const result = await apiRequest<{ photos: string[] }>(
        `/api/business/deposits/${encodeURIComponent(deposit.id)}/photos`,
      );
      setData((current) => ({
        ...current,
        deposits: current.deposits.map((item) =>
          item.id === deposit.id ? { ...item, photos: result.photos } : item,
        ),
      }));
    } catch (photoError) {
      setError(getMessage(photoError));
    }
  }

  function navigateTo(nextView: View) {
    setView(nextView);
    if (moreOpen) closeMoreMenu();
    else setMoreOpen(false);
    setError("");
  }

  async function updateProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setError("");
    setSuccess("");
    try {
      const result = await apiRequest<{ account: Omit<LocalAccount, "salt" | "passwordHash"> }>(
        "/api/auth/profile",
        {
          method: "PATCH",
          body: {
            name: String(formData.get("name") ?? ""),
            className: String(formData.get("className") ?? ""),
            whatsapp: String(formData.get("whatsapp") ?? ""),
          },
        },
      );
      const updated = cacheServerAccount(result.account);
      onAccountChange(updated);
      notifyAuthChanged();
      setSuccess("Data profil berhasil diperbarui.");
    } catch (profileError) {
      setError(getMessage(profileError));
    }
  }

  async function updatePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setError("");
    setSuccess("");
    const formData = new FormData(form);
    const currentPassword = String(formData.get("currentPassword") ?? "");
    const newPassword = String(formData.get("newPassword") ?? "");
    const confirmation = String(formData.get("confirmPassword") ?? "");
    if (newPassword !== confirmation) {
      setError("Konfirmasi kata sandi baru belum cocok.");
      return;
    }
    try {
      await apiRequest<{ message: string }>("/api/auth/password", {
        method: "PUT",
        body: { currentPassword, newPassword },
      });
      notifyAuthChanged();
      form.reset();
      setSuccess("Kata sandi berhasil diperbarui.");
    } catch (passwordError) {
      setError(getMessage(passwordError));
    }
  }

  async function saveManagerContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const whatsapp = String(formData.get("managerWhatsapp") ?? "");
    await runBusinessAction(async () => {
      const result = await apiRequest<{
        account: Omit<LocalAccount, "salt" | "passwordHash">;
      }>("/api/auth/profile", {
        method: "PATCH",
        body: {
          name: account.name,
          className: account.className ?? "",
          whatsapp,
        },
      });
      const updated = cacheServerAccount(result.account);
      onAccountChange(updated);
      notifyAuthChanged();
    }, "Nomor WhatsApp kontak berhasil diperbarui.");
  }

  async function toggleInAppNotifications(enabled: boolean) {
    await runBusinessAction(async () => {
      await apiRequest("/api/business/preferences", {
        method: "PATCH",
        body: { inAppNotifications: enabled },
      });
    }, enabled ? "Notifikasi dalam website diaktifkan." : "Notifikasi dalam website dinonaktifkan.");
  }

  async function saveConversionRate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const rupiahPerPoint = Number(formData.get("rupiahPerPoint"));
    await runBusinessAction(async () => {
      await apiRequest("/api/business/conversion-rate", {
        method: "PATCH",
        body: { rupiahPerPoint },
      });
    }, "Nilai konversi poin berhasil diperbarui.");
  }

  function renderProfileHub() {
    return (
      <section className={styles.profileGrid}>
        <div className={styles.profileCard}>
          <div className={styles.profileAvatar}>{account.name.trim().charAt(0).toUpperCase()}</div>
          <div>
            <h2>{account.name}</h2>
            <p>{isManager ? "Pengelola Bank Sampah" : `Peserta didik${account.className ? ` · ${account.className}` : ""}`}</p>
            <small>{isManager ? `Nama pengguna: ${account.identifier}` : `NISN: ${account.identifier}`}</small>
          </div>
        </div>
        <div className={styles.profileMenuCard}>
          <p className={styles.profileMenuHeading}>AKUN</p>
          <ProfileMenuItem icon="◉" title="Data akun" detail="Nama, kelas, dan nomor WhatsApp" onClick={() => navigateTo("profile-details")} />
          <ProfileMenuItem icon="♧" title="Keamanan" detail="Ubah kata sandi akun" onClick={() => navigateTo("security")} />
          <ProfileMenuItem icon="♧" title="Preferensi notifikasi" detail="Atur pemberitahuan dalam website" onClick={() => navigateTo("preferences")} />
          <p className={styles.profileMenuHeading}>LAINNYA</p>
          <ProfileMenuItem icon="⚙" title="Pengaturan" detail="Kontak pengelola dan preferensi" onClick={() => navigateTo("settings")} />
          <ProfileMenuItem icon="?" title="Bantuan & informasi" detail="Tentang aplikasi dan penyimpanan data" onClick={() => navigateTo("help")} />
          <button className={styles.profileLogout} onClick={handleLogout} type="button">
            <span aria-hidden="true">↪</span><span><strong>Keluar</strong><small>Akhiri sesi akun di browser ini</small></span><span aria-hidden="true">›</span>
          </button>
        </div>
      </section>
    );
  }

  async function approveSelectedDeposit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedDeposit) return;
    setDecisionPending(true);
    const succeeded = await runBusinessAction(async () => {
      await apiRequest("/api/business/deposits/" + encodeURIComponent(selectedDeposit.id) + "/review", {
        method: "POST",
        body: {
          decision: "approve",
          lines: selectedDeposit.lines.map((line, index) => ({
            wasteTypeId: reviewTypes[`${index}`] ?? reviewTypes[line.wasteTypeId] ?? line.wasteTypeId,
            quantity: Number(reviewWeights[`${index}`]),
          })),
          note: reviewNote,
        },
      });
    }, "Setoran disetujui dan poin peserta sudah diperbarui.");
    setDecisionPending(false);
    if (succeeded) setSelectedDepositId("");
  }

  async function rejectSelectedDeposit() {
    if (!selectedDeposit) return;
    setDecisionPending(true);
    const succeeded = await runBusinessAction(async () => {
      await apiRequest("/api/business/deposits/" + encodeURIComponent(selectedDeposit.id) + "/review", {
        method: "POST",
        body: { decision: "reject", note: reviewNote },
      });
    }, "Setoran ditolak dan alasan sudah dikirim ke peserta.");
    setDecisionPending(false);
    if (succeeded) setSelectedDepositId("");
  }

  async function saveStudent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");
    try {
      const result = await apiRequest<{
        student: Omit<LocalAccount, "salt" | "passwordHash">;
      }>(`/api/auth/students/${encodeURIComponent(studentEditId)}`, {
        method: "PATCH",
        body: {
          name: studentName,
          className: studentClass,
          whatsapp: studentWhatsapp,
          active: studentActive,
        },
      });
      cacheServerAccount(result.student);
      await refreshServerStudents();
      setStudentEditId("");
      setSuccess("Data peserta berhasil diperbarui.");
    } catch (saveError) {
      setError(getMessage(saveError));
    }
  }

  async function importStudentFile(file: File) {
    setImportingStudents(true);
    setError("");
    setSuccess("");
    try {
      const records: StudentImportRow[] = await parseStudentImportFile(file);
      const result = await apiRequest<{
        importedCount: number;
        credentials: StudentCredential[];
      }>("/api/auth/students/import", {
        method: "POST",
        body: { students: records },
      });
      setImportedCredentials((current) => [...current, ...result.credentials]);
      setSuccess(`${result.importedCount} akun siswa berhasil dibuat.`);
      await refreshServerStudents();
    } catch (importError) {
      setError(getMessage(importError));
    } finally {
      setImportingStudents(false);
    }
  }

  function changeWasteName(name: string) {
    setWasteName(name);
    setWasteIcon(suggestWasteIcon(name));
  }

  async function saveWaste(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (wasteVisualMode === "photo" && !wasteImage) {
      setError("Pilih foto sampah atau gunakan tampilan ikon.");
      return;
    }
    const image = wasteVisualMode === "photo" ? wasteImage : null;
    const payload = {
      name: wasteName,
      pointsPerUnit: Number(wastePrice),
      unit: wasteUnit,
      icon: wasteIcon,
      image,
      active: editingType?.active ?? true,
    };
    const succeeded = await runBusinessAction(async () => {
      await apiRequest(
        editingType
          ? `/api/business/waste-types/${encodeURIComponent(editingType.id)}`
          : "/api/business/waste-types",
        { method: editingType ? "PATCH" : "POST", body: payload },
      );
    }, editingType ? "Jenis dan tarif poin sampah diperbarui." : "Jenis sampah berhasil ditambahkan.");
    if (succeeded) {
      setEditingType(null);
      setWasteName("");
      setWastePrice("");
      setWasteUnit("kg");
      setWasteIcon("♻️");
      setWasteImage(null);
      setWasteVisualMode("icon");
    }
  }

  async function selectWasteImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    try {
      setWasteImage(await compressPhoto(file));
      setError("");
    } catch (imageError) {
      setError(getMessage(imageError));
    }
  }

  async function toggleWaste(item: WasteType) {
    await runBusinessAction(
      async () => {
        await apiRequest(`/api/business/waste-types/${encodeURIComponent(item.id)}`, {
          method: "PATCH",
          body: {
          name: item.name,
          pointsPerUnit: item.pointsPerUnit,
          unit: item.unit,
          active: !item.active,
          icon: item.icon ?? suggestWasteIcon(item.name),
          image: item.image ?? null,
          },
        });
      },
      item.active ? "Jenis sampah dinonaktifkan." : "Jenis sampah diaktifkan.",
    );
  }

  function selectWasteType(id: string) {
    setStudentWasteIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }

  async function handlePhotoChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    setError("");
    if (studentPhotos.length + files.length > 5) {
      setError("Maksimal 5 foto untuk satu pengajuan.");
      return;
    }
    try {
      const compressed = await Promise.all(files.map(compressPhoto));
      const newPhotos = [...studentPhotos, ...compressed];
      if (newPhotos.reduce((sum, photo) => sum + photo.length, 0) > 1_600_000) {
        setError("Total ukuran foto terlalu besar untuk dikirim. Kurangi jumlah atau ukuran foto.");
        return;
      }
      setStudentPhotos(newPhotos);
      setPhotoNames((current) => [...current, ...files.map((file) => file.name)]);
    } catch (photoError) {
      setError(getMessage(photoError));
    }
  }

  async function submitStudentDeposit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDepositBusy(true);
    await runBusinessAction(async () => {
      await apiRequest("/api/business/deposits", {
        method: "POST",
        body: {
          wasteTypeIds: studentWasteIds,
          photos: studentPhotos.map((dataUrl, index) => ({
            dataUrl,
            name: photoNames[index] ?? `foto-${index + 1}.jpg`,
          })),
        },
      });
      setStudentWasteIds([]);
      setStudentPhotos([]);
      setPhotoNames([]);
    }, "Pengajuan setoran berhasil dikirim kepada pengelola.");
    setDepositBusy(false);
  }

  if (!ready) {
    return <main className={styles.loading}>Memuat data dari server…</main>;
  }

  return (
    <main className={styles.appShell}>
      <header className={styles.topbar}>
        <Link className={styles.brand} href="/" aria-label="Bank Sampah Sekolah Merdeka">
          <span className={styles.brandMark} aria-hidden="true">✳</span>
          <span><strong>Bank Sampah</strong><small>Sekolah Merdeka</small></span>
        </Link>
        <div className={styles.accountArea}>
          <button
            aria-current={view === "profile" ? "page" : undefined}
            className={`${styles.profileTrigger} ${view === "profile" ? styles.profileTriggerActive : ""}`}
            onClick={() => navigateTo("profile")}
            type="button"
          >
            <span className={styles.profileTriggerAvatar}>{account.name.trim().charAt(0).toUpperCase()}</span>
            <span className={styles.accountName}>{account.name}</span>
          </button>
          <span className={styles.roleBadge}>{isManager ? "Pengelola" : "Peserta didik"}</span>
        </div>
      </header>

      <div className={styles.layout}>
        <nav className={styles.sidebar} aria-label="Navigasi utama">
          <p className={styles.navLabel}>MENU</p>
          {navItems.map((item) => (
            <button
              aria-label={viewNames[item]}
              aria-current={view === item ? "page" : undefined}
              className={`${styles.navButton} ${view === item ? styles.navActive : ""}`}
              key={item}
              onClick={() => navigateTo(item)}
              type="button"
            >
              <span aria-hidden="true">{navIcon(item)}</span>
              {viewNames[item]}
              {item === "notifications" && unreadCount > 0 && (
                <span className={styles.navCount}>{unreadCount}</span>
              )}
            </button>
          ))}
          <div className={styles.sidebarNote}>
            <span>Data tersimpan aman</span>
            <p>Data akun dan aktivitas tersimpan di server dan dapat diakses antar perangkat.</p>
          </div>
        </nav>

        <section className={styles.mainContent}>
          <div className={styles.pageHeading}>
            <div>
              {["profile-details", "security", "preferences", "settings", "contact", "help"].includes(view) && (
                <button className={styles.backButton} onClick={() => navigateTo(view === "contact" ? "settings" : "profile")} type="button">
                  ← Kembali {view === "contact" ? "ke Pengaturan" : "ke Profil"}
                </button>
              )}
              <p className={styles.eyebrow}>
                {view === "overview"
                  ? isManager ? "RUANG PENGELOLA" : "RUANG PESERTA"
                  : view === "profile" ? "AKUN SAYA" : "PROFIL & PREFERENSI"}
              </p>
              <h1>{headingFor(view, account.name)}</h1>
              <p>{descriptionFor(view, isManager)}</p>
            </div>
            {view === "overview" && (
              <span className={styles.localPill}>Tersinkron ke server</span>
            )}
          </div>

          {(error || success) && (
            <p className={`${styles.feedback} ${error ? styles.feedbackError : styles.feedbackSuccess}`} role={error ? "alert" : "status"}>
              {error || success}
            </p>
          )}

          {view === "overview" && (
            isManager ? (
              <ManagerOverview
                balance={allBalance}
                notifications={unreadCount}
                onNavigate={setView}
                pendingCount={pendingDeposits.length}
                students={students}
                transactions={recentTransactions}
                wasteTypes={data.wasteTypes}
              />
            ) : (
              <StudentOverview
                account={account}
                balance={myAvailablePoints}
                deposits={myDeposits}
                rupiahPerPoint={settings.rupiahPerPoint}
                onNavigate={setView}
              />
            )
          )}
          {view === "deposits" && (
            isManager ? (
              <ManagerDeposits
                data={data}
                filter={depositFilter}
                onFilter={setDepositFilter}
                onOpen={openDeposit}
                onCancel={() => setSelectedDepositId("")}
                selected={selectedDeposit}
                onApprove={approveSelectedDeposit}
                onReject={rejectSelectedDeposit}
                onReviewType={(key, id) => setReviewTypes((current) => ({ ...current, [key]: id }))}
                onReviewWeight={(key, weight) => setReviewWeights((current) => ({ ...current, [key]: weight }))}
                onReviewNote={setReviewNote}
                reviewNote={reviewNote}
                reviewTypes={reviewTypes}
                reviewWeights={reviewWeights}
                students={students}
                busy={decisionPending}
              />
            ) : (
              <StudentDeposits
                activeWasteTypes={activeWasteTypes}
                busy={depositBusy}
                deposits={myDeposits}
                onCancelDeposit={(depositId) =>
                  runBusinessAction(async () => {
                    await apiRequest(`/api/business/deposits/${encodeURIComponent(depositId)}/cancel`, {
                      method: "POST",
                    });
                  }, "Pengajuan setoran dibatalkan.")
                }
                onPhotoChange={handlePhotoChange}
                onSelectWaste={selectWasteType}
                onSubmit={submitStudentDeposit}
                photoNames={photoNames}
                photos={studentPhotos}
                selectedIds={studentWasteIds}
              />
            )
          )}
          {view === "students" && isManager && (
            <ManagerStudents
              filteredStudents={filteredStudents}
              search={search}
              onSearch={setSearch}
              onEdit={startEditStudent}
              onShowDetails={(student) =>
                setStudentDetailId((current) => current === student.id ? "" : student.id)
              }
              balanceFor={(studentId) => getStudentPoints(data, studentId)}
              data={data}
              detailStudent={students.find((student) => student.id === studentDetailId) ?? null}
              availableBalanceFor={(studentId) => getStudentAvailablePoints(data, studentId)}
              reservedBalanceFor={(studentId) => getStudentPoints(data, studentId) - getStudentAvailablePoints(data, studentId)}
              onCloseDetails={() => setStudentDetailId("")}
              editingId={studentEditId}
              name={studentName}
              className={studentClass}
              whatsapp={studentWhatsapp}
              active={studentActive}
              onName={setStudentName}
              onClass={setStudentClass}
              onWhatsapp={setStudentWhatsapp}
              onActive={setStudentActive}
              onSave={saveStudent}
              onCancel={() => setStudentEditId("")}
              importing={importingStudents}
              importedCredentials={importedCredentials}
              onImport={(file) => void importStudentFile(file)}
              onClearCredentials={() => setImportedCredentials([])}
            />
          )}
          {view === "waste" && isManager && (
            <ManagerWasteTypes
              items={data.wasteTypes}
              editing={editingType}
              name={wasteName}
              price={wastePrice}
              unit={wasteUnit}
              rupiahPerPoint={settings.rupiahPerPoint}
              onName={changeWasteName}
              onPrice={setWastePrice}
              onUnit={setWasteUnit}
              onEdit={startEditWasteType}
              icon={wasteIcon}
              image={wasteImage}
              visualMode={wasteVisualMode}
              onIcon={setWasteIcon}
              onImageChange={selectWasteImage}
              onRemoveImage={() => setWasteImage(null)}
              onVisualMode={setWasteVisualMode}
              onToggle={toggleWaste}
              onSave={saveWaste}
              onCancel={() => {
                setEditingType(null);
                setWasteName("");
                setWastePrice("");
                setWasteUnit("kg");
                setWasteIcon("♻️");
                setWasteImage(null);
                setWasteVisualMode("icon");
              }}
            />
          )}
          {view === "transactions" && isManager && (
            <RewardCenter
              mode="catalog"
              data={data}
              accountId={account.id}
              students={students}
              availablePoints={0}
              onCreate={(input) =>
                runBusinessAction(async () => {
                  await apiRequest("/api/business/rewards", { method: "POST", body: input });
                }, "Reward berhasil ditambahkan.")
              }
              onUpdate={(id, input) =>
                runBusinessAction(async () => {
                  await apiRequest(`/api/business/rewards/${encodeURIComponent(id)}`, {
                    method: "PATCH",
                    body: input,
                  });
                }, "Reward berhasil diperbarui.")
              }
              onRequest={() => undefined}
              onReview={() => undefined}
              onFulfill={() => undefined}
            />
          )}
          {view === "withdrawals" && (
            isManager ? (
              <RewardCenter
                mode="requests"
                data={data}
                accountId={account.id}
                students={students}
                availablePoints={0}
                onCreate={() => false}
                onUpdate={() => false}
                onRequest={() => undefined}
                onReview={async (requestId, decision, note) => {
                  await runBusinessAction(async () => {
                    await apiRequest(`/api/business/redemptions/${encodeURIComponent(requestId)}/review`, {
                      method: "POST",
                      body: { decision, note },
                    });
                  }, decision === "approve" ? "Penukaran disetujui; poin sudah digunakan." : "Pengajuan penukaran ditolak.");
                }}
                onFulfill={async (requestId) => {
                  await runBusinessAction(async () => {
                    await apiRequest(`/api/business/redemptions/${encodeURIComponent(requestId)}/fulfill`, {
                      method: "POST",
                    });
                  }, "Reward ditandai sudah diserahkan.");
                }}
              />
            ) : (
              <RewardCenter
                mode="student"
                data={data}
                accountId={account.id}
                students={students}
                availablePoints={myAvailablePoints}
                onCreate={() => false}
                onUpdate={() => false}
                onRequest={async (rewardId) => {
                  await runBusinessAction(async () => {
                    await apiRequest("/api/business/redemptions", {
                      method: "POST",
                      body: { rewardId },
                    });
                  }, "Pengajuan penukaran berhasil dikirim.");
                }}
                onReview={() => undefined}
                onFulfill={() => undefined}
              />
            )
          )}
          {view === "balance" && !isManager && (
            <StudentPoints
              total={myBalance}
              available={myAvailablePoints}
              entries={data.pointEntries
                .filter((entry) => entry.studentId === account.id)
                .sort((left, right) => right.createdAt.localeCompare(left.createdAt))}
              rupiahPerPoint={settings.rupiahPerPoint}
            />
          )}
          {view === "ranking" && !isManager && (
            <MonthlyRanking currentStudentId={account.id} />
          )}
          {view === "notifications" && (
            <NotificationList
              items={myNotifications}
              onReadAll={() =>
                runBusinessAction(async () => {
                  await apiRequest("/api/business/notifications/read-all", { method: "PATCH" });
                }, "Semua notifikasi ditandai sudah dibaca.")
              }
              onRead={(notification: BusinessNotification) =>
                runBusinessAction(async () => {
                  await apiRequest(`/api/business/notifications/${encodeURIComponent(notification.id)}/read`, {
                    method: "PATCH",
                  });
                }, "Notifikasi ditandai sudah dibaca.")
              }
            />
          )}
          {view === "profile" && renderProfileHub()}
          {view === "profile-details" && (
            <ProfileDetails
              account={account}
              onSave={updateProfile}
            />
          )}
          {view === "security" && <SecuritySettings onSave={updatePassword} />}
          {view === "preferences" && (
            <NotificationPreferences
              enabled={settings.inAppNotifications}
              onChange={toggleInAppNotifications}
            />
          )}
          {view === "settings" && (
            <SettingsOptions
              manager={isManager}
              notificationsEnabled={settings.inAppNotifications}
              onConversion={() => navigateTo("conversion")}
              onContact={() => navigateTo("contact")}
              onHelp={() => navigateTo("help")}
              onPreferences={() => navigateTo("preferences")}
            />
          )}
          {view === "conversion" && isManager && (
            <ConversionRateSettings
              rupiahPerPoint={settings.rupiahPerPoint}
              onSave={saveConversionRate}
            />
          )}
          {view === "contact" && (
            <ManagerContactSettings
              manager={isManager}
              whatsapp={managerWhatsapp}
              onSave={saveManagerContact}
              onHelp={() => navigateTo("help")}
            />
          )}
          {view === "help" && <BusinessDataHelp />}
        </section>
      </div>
      {moreOpen && (
        <div className={styles.mobileMoreLayer}>
          <button
            aria-label="Tutup menu lainnya"
            className={styles.mobileMoreScrim}
            onClick={closeMoreMenu}
            type="button"
          />
          <div
            aria-label="Menu lainnya"
            className={styles.mobileMorePanel}
            role="menu"
            style={{
              "--radial-anchor-x": `${viewportSize.anchorX || radialLayoutWidth / 2}px`,
              "--radial-anchor-y": `${viewportSize.anchorY || viewportSize.navTop || 0}px`,
              "--radial-card-width": `${radialCardWidth}px`,
              "--radial-card-height": `${radialCardHeight}px`,
            } as CSSProperties}
          >
            {mobileOverflowNav.map((item, index) => {
              const angle = mobileOverflowAngles[index] * Math.PI / 180;
              const x = Math.cos(angle) * radialRadius;
              const y = Math.sin(angle) * radialRadius;
              const itemStyle = item === "deposits"
                ? styles.moreItemDeposit
                : item === "waste"
                  ? styles.moreItemWaste
                  : item === "transactions"
                    ? styles.moreItemTransaction
                    : item === "withdrawals"
                      ? styles.moreItemWithdrawal
                      : styles.moreItemBalance;
              return (
                <button
                  aria-label={viewNames[item]}
                  aria-current={view === item ? "page" : undefined}
                  className={`${styles.moreItem} ${itemStyle} ${
                    !isManager ? styles.moreItemStudent : ""
                  } ${view === item ? styles.moreItemActive : ""}`}
                  key={item}
                  onClick={() => navigateTo(item)}
                  role="menuitem"
                  style={{
                    left: `${(viewportSize.anchorX || radialLayoutWidth / 2) + x}px`,
                    top: `calc(var(--radial-anchor-y) - ${y}px)`,
                  } as CSSProperties}
                  type="button"
                >
                  <span className={styles.moreItemLabel}>{mobileMenuLabel(item)}</span>
                  <span aria-hidden="true" className={styles.moreItemIcon}>{navIcon(item)}</span>
                  {item === "deposits" && pendingDeposits.length > 0 && (
                    <span className={styles.moreUnread}>{pendingDeposits.length} menunggu</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
      <nav className={styles.mobileNav} aria-label="Navigasi bawah">
        {mobileNavItems.map((item) => (
          <button
            aria-current={view === item ? "page" : undefined}
            className={`${styles.mobileNavItem} ${view === item ? styles.mobileNavActive : ""}`}
            key={item}
            onClick={() => {
              closeMoreMenu();
              navigateTo(item);
            }}
            type="button"
          >
            <span className={styles.mobileNavIcon} aria-hidden="true">{navIcon(item)}</span>
            <span>{mobileViewName(item)}</span>
            {item === "notifications" && unreadCount > 0 && (
              <span className={styles.mobileNavBadge}>{unreadCount}</span>
            )}
          </button>
        ))}
        {mobileOverflowNav.length > 0 && (
          <button
            aria-expanded={moreOpen}
            aria-haspopup="menu"
            aria-label={moreOpen ? "Tutup menu" : "Buka menu"}
            className={`${styles.mobileNavItem} ${
              moreOpen || mobileOverflowNav.includes(view) ? styles.mobileNavActive : ""
            } ${moreOpen ? styles.mobileNavMoreOpen : ""}`}
            onClick={toggleMoreMenu}
            type="button"
          >
            <span className={styles.mobileNavIcon} aria-hidden="true">{moreOpen ? "×" : "•••"}</span>
            <span>{moreOpen ? "Tutup" : "Menu"}</span>
          </button>
        )}
        <button
          aria-current={view === "notifications" ? "page" : undefined}
          className={`${styles.mobileNavItem} ${view === "notifications" ? styles.mobileNavActive : ""}`}
          onClick={() => navigateTo("notifications")}
          type="button"
        >
          <span className={styles.mobileNavIcon} aria-hidden="true">{navIcon("notifications")}</span>
          <span>Notifikasi</span>
          {unreadCount > 0 && <span className={styles.mobileNavBadge}>{unreadCount}</span>}
        </button>
        <button
          aria-current={view === "profile" ? "page" : undefined}
          className={`${styles.mobileNavItem} ${view === "profile" ? styles.mobileNavActive : ""}`}
          onClick={() => navigateTo("profile")}
          type="button"
        >
          <span className={styles.mobileNavIcon} aria-hidden="true">{navIcon("profile")}</span>
          <span>Profil</span>
        </button>
      </nav>
      <footer className={styles.footer}>© Sekolah Merdeka · Bank Sampah</footer>
    </main>
  );
}

function navIcon(item: View) {
  return {
    overview: "⌂",
    deposits: "↗",
    students: "◉",
    waste: "◈",
    transactions: "✳",
    balance: "✳",
    withdrawals: "⇄",
    ranking: "♕",
    notifications: "♧",
    profile: "◉",
    "profile-details": "◉",
    security: "♧",
    preferences: "♧",
    settings: "⚙",
    conversion: "⇄",
    contact: "↗",
    help: "?",
  }[item];
}

function mobileViewName(item: View) {
  if (item === "deposits") return "Setoran";
  return item === "profile" ? "Profil" : viewNames[item];
}

function mobileMenuLabel(item: View) {
  if (item === "deposits") return "Setoran";
  if (item === "waste") return "Tarif poin";
  if (item === "transactions") return "Reward";
  if (item === "withdrawals") return "Penukaran";
  if (item === "balance") return "Poin & riwayat";
  return viewNames[item];
}

function headingFor(view: View, name: string) {
  if (view === "overview") return `Halo, ${name.split(" ")[0]}.`;
  return viewNames[view];
}

function descriptionFor(view: View, manager: boolean) {
  if (view === "overview") {
    return manager
      ? "Kelola setoran, tarif poin, peserta, dan penukaran reward."
      : "Ajukan setoran, kumpulkan poin, lalu tukarkan dengan reward.";
  }
  const descriptions: Partial<Record<View, string>> = {
    deposits: manager
      ? "Periksa foto setoran, catat berat hasil timbangan, lalu proses pengajuan."
      : "Pilih jenis sampah dan unggah foto untuk mengajukan setoran.",
    students: "Cari peserta, perbarui informasi, atau nonaktifkan akun.",
    waste: "Atur tarif poin per satuan untuk setiap jenis sampah.",
    transactions: "Atur katalog reward barang atau uang dan biaya poinnya.",
    withdrawals: manager
      ? "Tinjau permintaan reward, gunakan poin saat menyetujui, lalu tandai penyerahan."
      : "Tukar poin dengan reward dari katalog yang disediakan pengelola.",
    ranking: "Bandingkan poin setoran yang kamu kumpulkan dengan peserta lain bulan ini.",
    balance: "Lihat jumlah poin, poin tersedia, dan riwayat perubahannya.",
    notifications: "Pemberitahuan aktivitas terkait akunmu.",
    profile: "Kelola akun dan preferensi aplikasi.",
    "profile-details": "Perbarui informasi akun yang tersimpan di server.",
    security: "Ganti kata sandi akunmu.",
    preferences: "Atur pemberitahuan aktivitas di dalam website.",
    settings: "Atur kontak pengelola dan preferensi notifikasi.",
    conversion: "Tentukan perkiraan nilai rupiah untuk setiap poin yang dimiliki peserta.",
    contact: "Atur kontak WhatsApp untuk komunikasi dengan peserta.",
    help: "Informasi tentang penggunaan aplikasi dan penyimpanan data.",
  };
  return descriptions[view] ?? "";
}

function ManagerOverview({
  balance,
  notifications,
  onNavigate,
  pendingCount,
  students,
  transactions,
  wasteTypes,
}: {
  balance: number;
  notifications: number;
  onNavigate: (view: View) => void;
  pendingCount: number;
  students: LocalAccount[];
  transactions: PointEntry[];
  wasteTypes: WasteType[];
}) {
  const activeCount = students.filter((student) => student.active !== false).length;
  return (
    <>
      <div className={styles.statGrid}>
        <Stat label="Menunggu pemeriksaan" value={String(pendingCount)} hint="Pengajuan setoran peserta" icon="↗" />
        <Stat label="Peserta aktif" value={String(activeCount)} hint="Akun peserta terdaftar" icon="◉" />
        <Stat label="Poin berjalan peserta" value={balance.toLocaleString("id-ID")} hint="Jumlah poin setelah penukaran disetujui" icon="✳" />
      </div>
      <div className={styles.twoColumns}>
        <section className={styles.card}>
          <SectionTitle title="Perlu diperiksa" action="Lihat semua" onAction={() => onNavigate("deposits")} />
          {pendingCount === 0 ? (
            <EmptyState title="Belum ada pengajuan" detail="Pengajuan setoran baru akan terlihat di sini." />
          ) : (
            <p className={styles.inlineSummary}>{pendingCount} pengajuan menunggu pemeriksaan.</p>
          )}
        </section>
        <section className={styles.card}>
          <SectionTitle title="Aktivitas poin terbaru" action="Katalog reward" onAction={() => onNavigate("transactions")} />
          {transactions.length === 0 ? (
            <EmptyState title="Belum ada perubahan poin" detail="Poin dari setoran yang disetujui dan penukaran akan tampil di sini." />
          ) : (
            <PointActivityRows entries={transactions} students={students} />
          )}
        </section>
      </div>
      <div className={styles.quickActions}>
        <button onClick={() => onNavigate("students")} type="button">Kelola peserta <span>→</span></button>
        <button onClick={() => onNavigate("waste")} type="button">Atur tarif poin <span>→</span></button>
        <button onClick={() => onNavigate("notifications")} type="button">Notifikasi {notifications > 0 && `(${notifications})`} <span>→</span></button>
      </div>
      {!wasteTypes.some((item) => item.active && item.pointsPerUnit > 0) && (
        <p className={styles.helperBanner}>Tambahkan jenis sampah dan tarif poin agar setoran bisa dinilai.</p>
      )}
    </>
  );
}

function PointActivityRows({
  entries,
  students,
}: {
  entries: PointEntry[];
  students: LocalAccount[];
}) {
  const studentMap = new Map(students.map((student) => [student.id, student]));
  return (
    <div className={styles.depositList}>
      {entries.map((entry) => (
        <article className={styles.depositRow} key={entry.id}>
          <div>
            <strong>{studentMap.get(entry.studentId)?.name ?? "Peserta tidak ditemukan"}</strong>
            <small>{entry.description} · {dateTime(entry.createdAt)}</small>
          </div>
          <b className={entry.amount > 0 ? styles.amountPositive : styles.amountNegative}>
            {entry.amount > 0 ? "+" : "−"}{Math.abs(entry.amount).toLocaleString("id-ID")} poin
          </b>
        </article>
      ))}
    </div>
  );
}

function Stat({ label, value, hint, icon }: { label: string; value: string; hint: string; icon: string }) {
  return (
    <article className={styles.statCard}>
      <span className={styles.statIcon}>{icon}</span>
      <p>{label}</p>
      <strong>{value}</strong>
      <small>{hint}</small>
    </article>
  );
}

function ManagerDeposits({
  data,
  filter,
  onFilter,
  onOpen,
  selected,
  onCancel,
  onApprove,
  onReject,
  onReviewType,
  onReviewWeight,
  onReviewNote,
  reviewNote,
  reviewTypes,
  reviewWeights,
  students,
  busy,
}: {
  data: BusinessData;
  filter: string;
  onFilter: (filter: string) => void;
  onOpen: (deposit: DepositRequest) => void;
  onCancel: () => void;
  onApprove: (event: FormEvent<HTMLFormElement>) => void;
  onReject: () => void;
  onReviewType: (key: string, id: string) => void;
  onReviewWeight: (key: string, weight: string) => void;
  onReviewNote: (note: string) => void;
  reviewNote: string;
  reviewTypes: Record<string, string>;
  reviewWeights: Record<string, string>;
  students: LocalAccount[];
  selected?: DepositRequest;
  busy: boolean;
}) {
  const [filterByStudent, setFilterByStudent] = useState("");
  const studentMap = new Map(students.map((student) => [student.id, student]));
  const deposits = data.deposits
    .filter((deposit) => filter === "all" || deposit.status === filter)
    .filter((deposit) => !filterByStudent || deposit.studentId === filterByStudent)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const activeTypes = data.wasteTypes.filter(
    (item) => item.active && item.pointsPerUnit > 0,
  );
  const approvedTotal =
    selected?.status === "approved" && selected.lines.some((line) => line.pointsAwarded !== undefined)
      ? selected.lines.reduce((sum, line) => sum + (line.pointsAwarded ?? 0), 0)
      : null;

  return (
    <>
      <section className={styles.card}>
        <div className={styles.toolbar}>
          <label className={styles.filterLabel}>
            Status
            <select onChange={(event) => onFilter(event.target.value)} value={filter}>
              <option value="pending">Menunggu pemeriksaan</option>
              <option value="approved">Disetujui</option>
              <option value="rejected">Ditolak</option>
              <option value="cancelled">Dibatalkan</option>
              <option value="all">Semua pengajuan</option>
            </select>
          </label>
          <label className={styles.filterLabel}>
            Peserta
            <select onChange={(event) => setFilterByStudent(event.target.value)} value={filterByStudent}>
              <option value="">Semua peserta</option>
              {students.map((student) => (
                <option key={student.id} value={student.id}>{student.name} · {student.identifier}</option>
              ))}
            </select>
          </label>
          <span className={styles.resultCount}>{deposits.length} pengajuan</span>
        </div>
        {deposits.length === 0 ? (
          <EmptyState title="Tidak ada pengajuan" detail="Pengajuan yang sesuai filter akan muncul di sini." />
        ) : (
          <DataTable headers={["Peserta", "Tanggal", "Jenis sampah", "Foto", "Status", "Aksi"]}>
            {deposits.map((deposit) => (
              <tr key={deposit.id}>
                <td>
                  <strong>{studentMap.get(deposit.studentId)?.name ?? "Peserta tidak ditemukan"}</strong>
                  <small>{studentMap.get(deposit.studentId)?.identifier ?? ""}</small>
                </td>
                <td>{dateTime(deposit.createdAt)}</td>
                <td>{deposit.lines.map((line) => line.wasteTypeName).join(", ")}</td>
                <td>{deposit.photos.length} foto</td>
                <td><StatusBadge status={deposit.status} /></td>
                <td><button className={styles.smallButton} onClick={() => onOpen(deposit)} type="button">Detail</button></td>
              </tr>
            ))}
          </DataTable>
        )}
      </section>

      {selected && (
        <section className={styles.card}>
          <div className={styles.sectionTitle}>
            <div>
              <h2>Detail pemeriksaan</h2>
              <p>{studentMap.get(selected.studentId)?.name ?? "Peserta"} · {dateTime(selected.createdAt)}</p>
            </div>
            <button className={styles.textButton} onClick={onCancel} type="button">Tutup</button>
          </div>
          <div className={styles.photoGrid}>
            {selected.photos.map((photo, index) => (
              <a href={photo} key={`${selected.id}-photo-${index}`} rel="noreferrer" target="_blank">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img alt={`Foto setoran ${index + 1}`} src={photo} />
              </a>
            ))}
          </div>
          {selected.status === "pending" ? (
            <form className={styles.reviewForm} onSubmit={onApprove}>
              <h3>Konfirmasi jumlah/berat sampah</h3>
              {selected.lines.map((line, index) => {
                const key = String(index);
                const selectedTypeId = reviewTypes[key] ?? line.wasteTypeId;
                const selectedType = data.wasteTypes.find((item) => item.id === selectedTypeId);
                const quantity = Number(reviewWeights[key] ?? "");
                const unit = selectedType?.unit ?? line.unit;
                const unitLabel = wasteUnitLabel(unit);
                const estimate =
                  selectedType && quantity > 0
                    ? `${Math.floor(quantity * selectedType.pointsPerUnit).toLocaleString("id-ID")} poin`
                    : selectedType && selectedType.pointsPerUnit <= 0
                      ? "Tarif poin belum diatur"
                      : "Isi jumlah untuk menghitung poin";
                return (
                  <div className={styles.reviewLine} key={`${line.wasteTypeId}-${index}`}>
                    <label>
                      Jenis sampah
                      <select
                        onChange={(event) => onReviewType(key, event.target.value)}
                        required
                        value={selectedTypeId}
                      >
                        {data.wasteTypes.map((type) => (
                          <option disabled={!type.active || type.pointsPerUnit <= 0} key={type.id} value={type.id}>
                            {type.name}{!type.active ? " (nonaktif)" : type.pointsPerUnit <= 0 ? " (atur tarif poin)" : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      {`Berat/volume aktual (${unitLabel})`}
                      <input
                        min="0.01"
                        onChange={(event) => onReviewWeight(key, event.target.value)}
                        required
                        step="0.01"
                        type="number"
                        value={reviewWeights[key] ?? ""}
                      />
                    </label>
                    <span className={styles.estimate}>{estimate}</span>
                  </div>
                );
              })}
              <label className={styles.field}>
                Catatan pengelola (opsional)
                <textarea onChange={(event) => onReviewNote(event.target.value)} value={reviewNote} />
              </label>
              <div className={styles.buttonRow}>
                <button className={styles.primaryButton} disabled={busy || activeTypes.length === 0} type="submit">
                  Setujui & tambahkan poin
                </button>
                <button className={styles.dangerButton} disabled={busy} onClick={onReject} type="button">
                  Tolak pengajuan
                </button>
              </div>
              {activeTypes.length === 0 && <p className={styles.formHint}>Aktifkan minimal satu jenis sampah sebelum menyetujui setoran.</p>}
            </form>
          ) : (
            <div className={styles.reviewSummary}>
              <StatusBadge status={selected.status} />
              {selected.lines.map((line, index) => (
                <p key={`${line.wasteTypeId}-${index}`}>
                  {line.wasteTypeName}: {line.quantity ?? "—"} {wasteUnitLabel(line.unit)}
                  {line.pointsAwarded !== null && line.pointsAwarded !== undefined ? ` = ${line.pointsAwarded.toLocaleString("id-ID")} poin` : ""}
                </p>
              ))}
              {approvedTotal !== null && <strong>Total: {approvedTotal.toLocaleString("id-ID")} poin</strong>}
              {selected.note && <p>Catatan: {selected.note}</p>}
            </div>
          )}
        </section>
      )}
    </>
  );
}

function StatusBadge({ status }: { status: DepositRequest["status"] }) {
  const className = {
    pending: styles.statusPending,
    approved: styles.statusApproved,
    rejected: styles.statusRejected,
    cancelled: styles.statusMuted,
  }[status];
  return <span className={`${styles.status} ${className}`}>{statusName(status)}</span>;
}

function ManagerStudents({
  filteredStudents,
  search,
  onSearch,
  onEdit,
  onShowDetails,
  balanceFor,
  data,
  detailStudent,
  availableBalanceFor,
  reservedBalanceFor,
  onCloseDetails,
  editingId,
  name,
  className,
  whatsapp,
  active,
  onName,
  onClass,
  onWhatsapp,
  onActive,
  onSave,
  onCancel,
  importing,
  importedCredentials,
  onImport,
  onClearCredentials,
}: {
  filteredStudents: LocalAccount[];
  search: string;
  onSearch: (value: string) => void;
  onEdit: (student: LocalAccount) => void;
  onShowDetails: (student: LocalAccount) => void;
  balanceFor: (studentId: string) => number;
  data: BusinessData;
  detailStudent: LocalAccount | null;
  availableBalanceFor: (studentId: string) => number;
  reservedBalanceFor: (studentId: string) => number;
  onCloseDetails: () => void;
  editingId: string;
  name: string;
  className: string;
  whatsapp: string;
  active: boolean;
  onName: (value: string) => void;
  onClass: (value: string) => void;
  onWhatsapp: (value: string) => void;
  onActive: (value: boolean) => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
  importing: boolean;
  importedCredentials: StudentCredential[];
  onImport: (file: File) => void;
  onClearCredentials: () => void;
}) {
  return (
    <section className={styles.card}>
      <div className={styles.studentImport}>
        <div>
          <h2>Impor data siswa</h2>
          <p>Unggah CSV atau Excel (.xlsx) dengan kolom NISN dan Nama; Kelas opsional. Format NISN sebagai teks agar angka nol di awal tetap tersimpan.</p>
          <button
            className={styles.textButton}
            onClick={() => downloadCsv("template-data-siswa.csv", [["NISN", "Nama", "Kelas"]])}
            type="button"
          >
            Unduh template CSV
          </button>
        </div>
        <label className={styles.field}>
          Pilih file siswa
          <input
            accept=".csv,.xlsx"
            disabled={importing}
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) onImport(file);
            }}
            type="file"
          />
        </label>
        {importing && <p role="status">Memvalidasi dan mengimpor data siswa…</p>}
      </div>
      {importedCredentials.length > 0 && (
        <div className={styles.studentImportResult}>
          <div className={styles.sectionTitle}>
            <div>
              <h2>Akun siswa berhasil dibuat</h2>
              <p>Simpan kata sandi sementara sekarang. Kata sandi ini hanya ditampilkan setelah impor.</p>
            </div>
            <button className={styles.textButton} onClick={onClearCredentials} type="button">Tutup</button>
          </div>
          <DataTable headers={["Nama", "NISN", "Kata sandi sementara"]}>
            {importedCredentials.map((credential) => (
              <tr key={credential.identifier}>
                <td>{credential.name}</td>
                <td>{credential.identifier}</td>
                <td><code>{credential.temporaryPassword}</code></td>
              </tr>
            ))}
          </DataTable>
          <button
            className={styles.primaryButton}
            onClick={() => downloadCsv(
              "kredensial-siswa-sementara.csv",
              [
                ["Nama", "NISN", "Kata sandi sementara"],
                ...importedCredentials.map((item) => [item.name, item.identifier, item.temporaryPassword]),
              ],
            )}
            type="button"
          >
            Unduh daftar kredensial
          </button>
        </div>
      )}
      <div className={styles.toolbar}>
        <label className={styles.searchField}>
          Cari peserta
          <input onChange={(event) => onSearch(event.target.value)} placeholder="Nama, NISN, atau kelas" value={search} />
        </label>
        <span className={styles.resultCount}>{filteredStudents.length} peserta</span>
      </div>
      {filteredStudents.length === 0 ? (
        <EmptyState title="Belum ada peserta" detail="Impor data siswa dari file untuk membuat akun peserta." />
      ) : (
        <DataTable headers={["Nama", "NISN", "Kelas", "Poin berjalan", "WhatsApp", "Status", "Aksi"]}>
          {filteredStudents.map((student) => (
            <tr key={student.id}>
              <td><strong>{student.name}</strong></td>
              <td>{student.identifier}</td>
              <td>{student.className || "—"}</td>
              <td>{balanceFor(student.id).toLocaleString("id-ID")} poin</td>
              <td>
                {student.whatsapp ? (
                  <a className={styles.tableLink} href={whatsappUrl(student.whatsapp, `Halo ${student.name}, saya pengelola Bank Sampah Sekolah Merdeka.`)} rel="noreferrer" target="_blank">WhatsApp</a>
                ) : "—"}
              </td>
              <td><span className={`${styles.status} ${student.active === false ? styles.statusRejected : styles.statusApproved}`}>{student.active === false ? "Nonaktif" : "Aktif"}</span></td>
              <td><div className={styles.tableActions}><button className={styles.smallButton} onClick={() => onShowDetails(student)} type="button">Detail</button><button className={styles.smallButton} onClick={() => onEdit(student)} type="button">Kelola</button></div></td>
            </tr>
          ))}
        </DataTable>
      )}
      {detailStudent && (
        <StudentDetail
          student={detailStudent}
          data={data}
          balance={balanceFor(detailStudent.id)}
          available={availableBalanceFor(detailStudent.id)}
          reserved={reservedBalanceFor(detailStudent.id)}
          onClose={onCloseDetails}
        />
      )}
      {editingId && (
        <form className={styles.inlineForm} onSubmit={onSave}>
          <div className={styles.sectionTitle}><h2>Edit data peserta</h2><button className={styles.textButton} onClick={onCancel} type="button">Tutup</button></div>
          <div className={styles.formGrid}>
            <label className={styles.field}>Nama lengkap<input onChange={(event) => onName(event.target.value)} required value={name} /></label>
            <label className={styles.field}>Kelas (opsional)<input onChange={(event) => onClass(event.target.value)} value={className} /></label>
            <label className={styles.field}>Nomor WhatsApp<input onChange={(event) => onWhatsapp(event.target.value)} required type="tel" value={whatsapp} /></label>
            <label className={styles.checkField}><input checked={active} onChange={(event) => onActive(event.target.checked)} type="checkbox" /> Akun peserta aktif</label>
          </div>
          <div className={styles.buttonRow}><button className={styles.primaryButton} type="submit">Simpan perubahan</button><button className={styles.secondaryButton} onClick={onCancel} type="button">Batal</button></div>
        </form>
      )}
    </section>
  );
}

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows
    .map((row) => row.map((value) => {
      const safeValue = /^[\u0000-\u0020]*[=+\-@]/.test(value) ? `'${value}` : value;
      return `"${safeValue.replace(/"/g, '""')}"`;
    }).join(","))
    .join("\r\n");
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function StudentDetail({
  student,
  data,
  balance,
  available,
  reserved,
  onClose,
}: {
  student: LocalAccount;
  data: BusinessData;
  balance: number;
  available: number;
  reserved: number;
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState<"deposits" | "points" | "redemptions">("deposits");
  const deposits = data.deposits
    .filter((deposit) => deposit.studentId === student.id)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const entries = data.pointEntries
    .filter((entry) => entry.studentId === student.id)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const withdrawals = data.redemptionRequests
    .filter((request) => request.studentId === student.id)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const approvedDepositPoints = deposits
    .filter((deposit) => deposit.status === "approved")
    .reduce(
      (total, deposit) =>
        total + deposit.lines.reduce((lineTotal, line) => lineTotal + (line.pointsAwarded ?? 0), 0),
      0,
    );
  const approvedQuantityByUnit = deposits
    .filter((deposit) => deposit.status === "approved")
    .flatMap((deposit) => deposit.lines)
    .reduce<Partial<Record<WasteUnit | "buah", number>>>((totals, line) => {
      totals[line.unit] = (totals[line.unit] ?? 0) + (line.quantity ?? 0);
      return totals;
    }, {});
  const approvedQuantitySummary = (["kg", "liter", "buah"] as const)
    .filter((unit) => approvedQuantityByUnit[unit])
    .map((unit) => `${(approvedQuantityByUnit[unit] ?? 0).toLocaleString("id-ID", { maximumFractionDigits: 2 })} ${unit}`)
    .join(" · ") || "0";
  return (
    <section className={styles.studentDetail}>
      <div className={styles.sectionTitle}>
        <div>
          <h2>Detail peserta</h2>
          <p>Informasi akun dan seluruh aktivitas peserta.</p>
        </div>
        <button className={styles.textButton} onClick={onClose} type="button">Tutup detail</button>
      </div>
      <div className={styles.studentProfile}>
        <div className={styles.studentProfileHeading}>
          <div className={styles.studentAvatar} aria-hidden="true">
            {student.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}
          </div>
          <div>
            <h3>{student.name}</h3>
            <span>{student.active === false ? "Akun nonaktif" : "Akun aktif"}</span>
          </div>
          <span className={`${styles.status} ${student.active === false ? styles.statusMuted : styles.statusApproved}`}>
            {student.active === false ? "Nonaktif" : "Aktif"}
          </span>
        </div>
        <div className={styles.studentProfileInfo}>
          <div><span>NISN</span><strong>{student.identifier}</strong></div>
          <div><span>Kelas</span><strong>{student.className || "Belum diisi"}</strong></div>
          <div>
            <span>WhatsApp</span>
            {student.whatsapp
              ? <a href={whatsappUrl(student.whatsapp, `Halo ${student.name}, saya pengelola Bank Sampah Sekolah Merdeka.`)} rel="noreferrer" target="_blank">{student.whatsapp}</a>
              : <strong>Belum diisi</strong>}
          </div>
          <div><span>Bergabung sejak</span><strong>{dateTime(student.createdAt)}</strong></div>
        </div>
      </div>
      <div className={styles.studentDetailStats}>
        <div><span>Poin berjalan</span><strong>{balance.toLocaleString("id-ID")}</strong></div>
        <div><span>Poin tersedia</span><strong>{available.toLocaleString("id-ID")}</strong></div>
        <div><span>Poin menunggu penukaran</span><strong>{reserved.toLocaleString("id-ID")}</strong></div>
        <div><span>Poin dari setoran</span><strong>{approvedDepositPoints.toLocaleString("id-ID")}</strong></div>
        <div><span>Setoran disetujui</span><strong>{deposits.filter((deposit) => deposit.status === "approved").length} pengajuan</strong></div>
        <div><span>Total jumlah disetujui</span><strong>{approvedQuantitySummary}</strong></div>
        <div><span>Penukaran selesai</span><strong>{withdrawals.filter((request) => request.status === "fulfilled").length}</strong></div>
        <div><span>Pengajuan menunggu</span><strong>{deposits.filter((deposit) => deposit.status === "pending").length + withdrawals.filter((request) => request.status === "pending").length} pengajuan</strong></div>
      </div>
      <div className={styles.studentHistory}>
        <div className={styles.studentHistoryTabs} role="tablist" aria-label="Riwayat aktivitas peserta">
          {([
            ["deposits", `Setoran (${deposits.length})`],
            ["points", `Riwayat poin (${entries.length})`],
            ["redemptions", `Reward (${withdrawals.length})`],
          ] as const).map(([tab, label]) => (
            <button
              aria-selected={activeTab === tab}
              className={activeTab === tab ? styles.studentHistoryTabActive : ""}
              id={`student-history-tab-${tab}`}
              key={tab}
              onClick={() => setActiveTab(tab)}
              role="tab"
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
        <div
          aria-labelledby={`student-history-tab-${activeTab}`}
          className={styles.studentHistoryPanel}
          role="tabpanel"
        >
          {activeTab === "deposits" && (deposits.length === 0
            ? <small>Belum ada pengajuan setoran.</small>
            : deposits.map((deposit) => (
              <article className={styles.studentActivityRow} key={deposit.id}>
                <div>
                  <strong>{deposit.lines.map((line) => line.wasteTypeName).join(", ") || "Setoran"}</strong>
                  <small>{dateTime(deposit.createdAt)} · {deposit.photos.length} foto</small>
                  {deposit.lines.map((line, index) => (
                    <small key={`${deposit.id}-${line.wasteTypeId}-${index}`}>
                      {line.wasteTypeName}: {line.quantity === null ? "Jumlah belum dicatat" : `${line.quantity} ${wasteUnitLabel(line.unit)}`}
                      {line.pointsAwarded !== null && line.pointsAwarded !== undefined ? ` · ${line.pointsAwarded.toLocaleString("id-ID")} poin` : ""}
                    </small>
                  ))}
                  {deposit.note && <small>Catatan: {deposit.note}</small>}
                </div>
                <div className={styles.studentActivityMeta}>
                  <span className={`${styles.status} ${deposit.status === "approved" ? styles.statusApproved : deposit.status === "rejected" ? styles.statusRejected : deposit.status === "pending" ? styles.statusPending : styles.statusMuted}`}>{statusName(deposit.status)}</span>
                  {deposit.lines.some((line) => line.pointsAwarded !== undefined) && (
                    <b>{deposit.lines.reduce((total, line) => total + (line.pointsAwarded ?? 0), 0).toLocaleString("id-ID")} poin</b>
                  )}
                </div>
              </article>
            )))}
          {activeTab === "points" && (entries.length === 0
            ? <small>Belum ada riwayat poin.</small>
            : entries.map((entry) => (
              <article className={styles.studentActivityRow} key={entry.id}>
                <div><strong>{entry.description}</strong><small>{dateTime(entry.createdAt)}</small></div>
                <b className={entry.amount >= 0 ? styles.amountPositive : styles.amountNegative}>{entry.amount >= 0 ? "+" : "−"}{Math.abs(entry.amount).toLocaleString("id-ID")} poin</b>
              </article>
            )))}
          {activeTab === "redemptions" && (withdrawals.length === 0
            ? <small>Belum ada penukaran reward.</small>
            : withdrawals.map((request) => (
              <article className={styles.studentActivityRow} key={request.id}>
                <div>
                  <strong>{request.rewardName}</strong>
                  <small>{request.pointsCost.toLocaleString("id-ID")} poin · Diajukan {dateTime(request.createdAt)}</small>
                  {request.note && <small>Catatan pengelola: {request.note}</small>}
                </div>
                <span className={`${styles.status} ${request.status === "fulfilled" ? styles.statusApproved : request.status === "rejected" ? styles.statusRejected : request.status === "pending" ? styles.statusPending : styles.statusProcessing}`}>{request.status === "fulfilled" ? "Selesai" : request.status === "approved" ? "Disetujui" : request.status === "pending" ? "Menunggu" : request.status === "rejected" ? "Ditolak" : "Dibatalkan"}</span>
              </article>
            )))}
        </div>
      </div>
    </section>
  );
}

function ManagerWasteTypes({
  items,
  editing,
  name,
  price,
  unit,
  rupiahPerPoint,
  icon,
  image,
  visualMode,
  onName,
  onPrice,
  onUnit,
  onIcon,
  onImageChange,
  onRemoveImage,
  onVisualMode,
  onEdit,
  onToggle,
  onSave,
  onCancel,
}: {
  items: WasteType[];
  editing: WasteType | null;
  name: string;
  price: string;
  unit: WasteUnit;
  rupiahPerPoint: number | null;
  icon: string;
  image: string | null;
  visualMode: "icon" | "photo";
  onName: (value: string) => void;
  onPrice: (value: string) => void;
  onUnit: (value: WasteUnit) => void;
  onIcon: (icon: string) => void;
  onImageChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onRemoveImage: () => void;
  onVisualMode: (mode: "icon" | "photo") => void;
  onEdit: (item: WasteType) => void;
  onToggle: (item: WasteType) => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}) {
  const enteredRate = Number(price);
  const estimatedRateValue = rupiahPerPoint !== null && Number.isSafeInteger(enteredRate) && enteredRate > 0
    ? getPointsRupiahValue(enteredRate, rupiahPerPoint)
    : null;
  return (
    <div className={styles.twoColumns}>
      <section className={styles.card}>
        <SectionTitle title="Daftar jenis sampah" />
        {items.length === 0 ? (
          <EmptyState title="Belum ada jenis sampah" detail="Tambahkan jenis sampah dan tarif poin di formulir." />
        ) : (
          <DataTable headers={["Jenis", "Tarif / satuan", "Status", "Aksi"]}>
            {items.map((item) => (
              <tr key={item.id}>
                <td><div className={styles.wasteTableName}><WasteVisual item={item} /><strong>{item.name}</strong></div></td>
                <td>
                  <div className={styles.wasteRate}>
                    <strong>{item.pointsPerUnit.toLocaleString("id-ID")} poin / {wasteUnitLabel(item.unit)}</strong>
                    {rupiahPerPoint !== null && (
                      <small>≈ {formatRupiah(BigInt(item.pointsPerUnit) * BigInt(rupiahPerPoint))} / {wasteUnitLabel(item.unit)}</small>
                    )}
                  </div>
                </td>
                <td><span className={`${styles.status} ${item.active ? styles.statusApproved : styles.statusMuted}`}>{item.active ? "Aktif" : "Nonaktif"}</span></td>
                <td>
                  {item.unit === "buah" ? (
                    <small className={styles.rateConversion}>PCS lama · tidak dapat diaktifkan</small>
                  ) : (
                    <div className={styles.tableActions}><button className={styles.smallButton} onClick={() => onEdit(item)} type="button">Edit</button><button className={styles.textButton} onClick={() => onToggle(item)} type="button">{item.active ? "Nonaktifkan" : "Aktifkan"}</button></div>
                  )}
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </section>
      <form className={styles.cardForm} onSubmit={onSave}>
        <h2>{editing ? "Ubah jenis sampah" : "Tambah jenis sampah"}</h2>
        <p>Jumlah poin dihitung dari tarif per satuan dikalikan berat/jumlah yang disetujui; pecahan dibulatkan ke bawah.</p>
        <label className={styles.field}>Nama jenis sampah<input maxLength={80} onChange={(event) => onName(event.target.value)} placeholder="Contoh: Botol plastik" required value={name} /></label>
        <label className={styles.field}>Satuan penimbangan/penghitungan
          <select onChange={(event) => onUnit(event.target.value as WasteUnit)} value={unit}>
            <option value="kg">Kilogram (kg)</option>
            <option value="liter">Liter (L)</option>
          </select>
        </label>
        <label className={styles.field}>
          Poin per {wasteUnitLabel(unit)}
          <input min="1" onChange={(event) => onPrice(event.target.value)} placeholder="Contoh: 10" required step="1" type="number" value={price} />
          {rupiahPerPoint !== null && estimatedRateValue !== null ? (
            <small className={styles.rateConversion}>
              Perkiraan konversi: <strong>{formatRupiah(estimatedRateValue)} / {wasteUnitLabel(unit)}</strong>
              {" "}({formatRupiah(rupiahPerPoint)} per poin). Ini nilai perkiraan, bukan saldo tunai.
            </small>
          ) : (
            <small className={styles.rateConversion}>
              {rupiahPerPoint === null
                ? "Atur nilai rupiah per poin di Profil → Pengaturan → Nilai konversi poin untuk melihat perkiraan rupiah."
                : "Masukkan jumlah poin yang valid untuk melihat perkiraan rupiah."}
            </small>
          )}
        </label>
        <fieldset className={styles.visualPicker}>
          <legend>Tampilan jenis sampah</legend>
          <div className={styles.visualModeButtons}>
            <button className={visualMode === "icon" ? styles.visualModeActive : ""} onClick={() => onVisualMode("icon")} type="button">Pakai ikon</button>
            <button className={visualMode === "photo" ? styles.visualModeActive : ""} onClick={() => onVisualMode("photo")} type="button">Pakai foto</button>
          </div>
          {visualMode === "icon" ? (
            <div className={styles.wasteIconChoices} aria-label="Pilih ikon">
              {wasteIcons.map((option) => (
                <button
                  aria-label={`Pilih ${option.name}`}
                  aria-pressed={icon === option.icon}
                  className={icon === option.icon ? styles.wasteIconSelected : ""}
                  key={option.icon}
                  onClick={() => {
                    onName(option.name);
                    onIcon(option.icon);
                  }}
                  title={option.name}
                  type="button"
                >
                  <WasteIcon icon={option.icon} />
                  <small>{option.name}</small>
                </button>
              ))}
            </div>
          ) : (
            <div className={styles.wasteImagePicker}>
              {image ? (
                <div className={styles.wasteImagePreview}>
                  <Image alt="Pratinjau foto sampah" height={68} src={image} unoptimized width={84} />
                  <button className={styles.textButton} onClick={onRemoveImage} type="button">Hapus foto</button>
                </div>
              ) : (
                <label className={styles.field}>Unggah foto sampah
                  <input accept="image/*" onChange={onImageChange} type="file" />
                </label>
              )}
              <small>Foto dikompres otomatis sebelum disimpan di browser.</small>
            </div>
          )}
          <div className={styles.wasteVisualPreview}>
            <WasteVisual item={{ icon, image: visualMode === "photo" ? image : null }} />
            <span>Pratinjau katalog peserta</span>
          </div>
        </fieldset>
        <div className={styles.buttonRow}><button className={styles.primaryButton} type="submit">{editing ? "Simpan perubahan" : "Tambah jenis"}</button>{editing && <button className={styles.secondaryButton} onClick={onCancel} type="button">Batal</button>}</div>
      </form>
    </div>
  );
}

function WasteVisual({ item }: { item: Pick<WasteType, "icon" | "image"> & Partial<Pick<WasteType, "name">> }) {
  if (item.image) {
    return <span className={styles.wasteVisual}><Image alt="" crossOrigin="use-credentials" height={36} src={item.image} unoptimized width={36} /></span>;
  }
  return (
    <span className={styles.wasteVisual} aria-hidden="true">
      <WasteIcon icon={item.icon ?? (item.name ? suggestWasteIcon(item.name) : "♻️")} />
    </span>
  );
}

function WasteIcon({ icon }: { icon: string }) {
  return (
    <svg
      aria-hidden="true"
      className={styles.wasteSvg}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      viewBox="0 0 32 32"
    >
      {icon === "♻️" ? (
        <>
          <path d="m12.1 6.1 2.2-3.8 3.2 5.5-2.2 3.8-1.2-2.1H9.8" />
          <path d="M9.8 9.5 7 14.3l-4.4-.1 3.2-5.5A4.6 4.6 0 0 1 9.8 6h2.8" />
          <path d="m24.1 12.3 4.4.1-3.2 5.5a4.6 4.6 0 0 1-4 2.3h-2.7" />
          <path d="m22.2 16.4 2.8-4.8-3.2-5.5-4.4.1" />
          <path d="m13 22.1-2.2 3.8-3.2-5.5 2.2-3.8 1.2 2.1h4.3" />
          <path d="M17.6 18.7H23l2.2 3.8-6.4.1a4.6 4.6 0 0 1-4-2.3l-1.4-2.4" />
        </>
      ) : icon === "🥤" ? (
        <>
          <path d="M18 3h5l-2 5" />
          <path d="M8 9h17l-2 18H10L8 9Z" />
          <path d="M9 14h15M12 6h9" />
        </>
      ) : icon === "🥫" ? (
        <>
          <path d="M8 6c0-1.7 3.6-3 8-3s8 1.3 8 3v20c0 1.7-3.6 3-8 3s-8-1.3-8-3V6Z" />
          <path d="M8 6c0 1.7 3.6 3 8 3s8-1.3 8-3M8 25c0 1.7 3.6 3 8 3s8-1.3 8-3M12 14h8" />
        </>
      ) : icon === "🍾" ? (
        <>
          <path d="M13 3h6v4l2 3v15a3 3 0 0 1-3 3h-4a3 3 0 0 1-3-3V10l2-3V3Z" />
          <path d="M13 7h6M11 14h10M14 3V1h4v2" />
        </>
      ) : icon === "📄" ? (
        <>
          <path d="M8 3h10l6 6v20H8V3Z" />
          <path d="M18 3v7h6M12 16h8M12 20h8M12 24h6" />
        </>
      ) : icon === "📦" ? (
        <>
          <path d="m4 10 12-6 12 6v13l-12 6-12-6V10Z" />
          <path d="m4 10 12 6 12-6M16 16v13M10 7l12 6" />
        </>
      ) : icon === "🔋" ? (
        <>
          <path d="M12 5V3h8v2M9 5h14v23H9V5Z" />
          <path d="M13 11h6M16 8v6M13 21h6" />
        </>
      ) : icon === "👕" ? (
        <>
          <path d="m11 5 5 3 5-3 8 4-4 7-4-2v13H11V14l-4 2-4-7 8-4Z" />
          <path d="M13 6a3 3 0 0 0 6 0" />
        </>
      ) : icon === "🍃" ? (
        <>
          <path d="M27 5C15 4 6 8 5 17c-.6 5 3.1 9 8 9 9 0 13-9 14-21Z" />
          <path d="M5 28c4-8 9-12 17-17M12 18l-1-5M17 14l5 1" />
        </>
      ) : icon === "🧴" ? (
        <>
          <path d="M13 3h6v4l2 2v3l3 3v13a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V15l3-3V9l2-2V3Z" />
          <path d="M13 3h6M11 12h10M12 19h8M16 7v2" />
        </>
      ) : (
        <>
          <path d="m12.1 6.1 2.2-3.8 3.2 5.5-2.2 3.8-1.2-2.1H9.8" />
          <path d="M9.8 9.5 7 14.3l-4.4-.1 3.2-5.5A4.6 4.6 0 0 1 9.8 6h2.8" />
          <path d="m24.1 12.3 4.4.1-3.2 5.5a4.6 4.6 0 0 1-4 2.3h-2.7" />
          <path d="m22.2 16.4 2.8-4.8-3.2-5.5-4.4.1" />
          <path d="m13 22.1-2.2 3.8-3.2-5.5 2.2-3.8 1.2 2.1h4.3" />
          <path d="M17.6 18.7H23l2.2 3.8-6.4.1a4.6 4.6 0 0 1-4-2.3l-1.4-2.4" />
        </>
      )}
    </svg>
  );
}

function ManagerTransactions({
  data,
  students,
  selectedStudentId,
  kind,
  direction,
  amount,
  description,
  reference,
  search,
  filter,
  from,
  to,
  onStudent,
  onKind,
  onDirection,
  onAmount,
  onDescription,
  onReference,
  onSearch,
  onFilter,
  onFrom,
  onTo,
  onSave,
  onConfirmSave,
}: {
  data: BusinessData;
  students: LocalAccount[];
  selectedStudentId: string;
  kind: "adjustment" | "withdrawal" | "redemption";
  direction: "add" | "subtract";
  amount: string;
  description: string;
  reference: string;
  search: string;
  filter: string;
  from: string;
  to: string;
  onStudent: (id: string) => void;
  onKind: (kind: "adjustment" | "withdrawal" | "redemption") => void;
  onDirection: (direction: "add" | "subtract") => void;
  onAmount: (amount: string) => void;
  onDescription: (description: string) => void;
  onReference: (reference: string) => void;
  onSearch: (value: string) => void;
  onFilter: (value: string) => void;
  onFrom: (value: string) => void;
  onTo: (value: string) => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  onConfirmSave: () => void;
}) {
  const [confirmingDebit, setConfirmingDebit] = useState(false);
  const studentMap = new Map(students.map((student) => [student.id, student]));
  const accountMap = new Map(getLocalAccounts().map((account) => [account.id, account]));
  const selectedStudent = students.find((student) => student.id === selectedStudentId);
  const selectedBalance = getStudentBalance(data, selectedStudentId);
  const selectedAvailable = getStudentAvailableBalance(data, selectedStudentId);
  const rawAmount = Number(amount);
  const reducesBalance = kind !== "adjustment" || direction === "subtract";
  const validDebitAmount = Number.isSafeInteger(rawAmount) && rawAmount > 0;
  const filteredEntries = data.walletEntries
    .filter((entry) => {
      const student = studentMap.get(entry.studentId);
      const creator = accountMap.get(entry.createdBy);
      const query = search.trim().toLocaleLowerCase("id-ID");
      const matchesSearch = !query || [
        student?.name,
        student?.identifier,
        entry.description,
        entry.reference,
        creator?.name,
      ].some((value) => value?.toLocaleLowerCase("id-ID").includes(query));
      const matchesType = filter === "all" || entry.kind === filter;
      const localTimestamp = new Date(entry.createdAt);
      const date = `${localTimestamp.getFullYear()}-${String(localTimestamp.getMonth() + 1).padStart(2, "0")}-${String(localTimestamp.getDate()).padStart(2, "0")}`;
      return matchesSearch && matchesType && (!from || date >= from) && (!to || date <= to);
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const totalIn = filteredEntries.reduce((total, entry) => total + Math.max(entry.amount, 0), 0);
  const totalOut = filteredEntries.reduce((total, entry) => total + Math.abs(Math.min(entry.amount, 0)), 0);
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (reducesBalance) {
      event.preventDefault();
      setConfirmingDebit(true);
      return;
    }
    onSave(event);
  };

  return (
    <div className={styles.twoColumns}>
      <form className={styles.cardForm} onSubmit={handleSubmit}>
        <h2>Catat transaksi saldo</h2>
        <p>Pencairan dan penukaran dicatat setelah uang atau barang diserahkan.</p>
        <label className={styles.field}>Peserta
          <select disabled={confirmingDebit} onChange={(event) => onStudent(event.target.value)} required value={selectedStudentId}>
            <option value="">Pilih peserta</option>
            {students.filter((student) => student.active !== false).map((student) => (
              <option key={student.id} value={student.id}>{student.name} · {student.identifier}</option>
            ))}
          </select>
        </label>
        {selectedStudent && (
          <p className={styles.balanceHint}>Saldo total: <strong>{formatRupiah(selectedBalance)}</strong> · Tersedia: <strong>{formatRupiah(selectedAvailable)}</strong></p>
        )}
        <label className={styles.field}>Jenis transaksi
          <select disabled={confirmingDebit} onChange={(event) => onKind(event.target.value as typeof kind)} value={kind}>
            <option value="adjustment">Koreksi saldo</option>
            <option value="withdrawal">Pencairan tunai</option>
            <option value="redemption">Penukaran reward/barang</option>
          </select>
        </label>
        {kind === "adjustment" && (
          <label className={styles.field}>Perubahan saldo
            <select disabled={confirmingDebit} onChange={(event) => onDirection(event.target.value as typeof direction)} value={direction}>
              <option value="add">Tambah saldo</option>
              <option value="subtract">Kurangi saldo</option>
            </select>
          </label>
        )}
        <label className={styles.field}>Nominal (Rp)<input disabled={confirmingDebit} min="1" onChange={(event) => onAmount(event.target.value)} required step="1" type="number" value={amount} /></label>
        <label className={styles.field}>Catatan / keterangan<textarea disabled={confirmingDebit} maxLength={240} onChange={(event) => onDescription(event.target.value)} placeholder="Contoh: pencairan tunai diserahkan di sekolah" required value={description} /></label>
        <label className={styles.field}>Referensi / nomor bukti (opsional)<input disabled={confirmingDebit} maxLength={80} onChange={(event) => onReference(event.target.value)} placeholder="Contoh: nomor kuitansi atau bukti serah-terima" value={reference} /></label>
        {confirmingDebit ? (
          <div className={styles.transactionConfirm}>
            <strong>Konfirmasi pengurangan saldo</strong>
            <p>{selectedStudent?.name ?? "Peserta"} · {entryName(kind)} · {formatRupiah(rawAmount)}</p>
            <small>Saldo tersedia setelah transaksi: {formatRupiah(selectedAvailable - rawAmount)}</small>
            <div className={styles.buttonRow}>
              <button className={styles.primaryButton} disabled={!selectedStudent || !validDebitAmount} onClick={() => { onConfirmSave(); setConfirmingDebit(false); }} type="button">Ya, simpan transaksi</button>
              <button className={styles.secondaryButton} onClick={() => setConfirmingDebit(false)} type="button">Periksa kembali</button>
            </div>
          </div>
        ) : (
          <button className={styles.primaryButton} type="submit">Simpan transaksi</button>
        )}
      </form>
      <section className={styles.card}>
        <SectionTitle title="Riwayat transaksi" />
        <div className={styles.transactionSummary}>
          <div><span>Transaksi</span><strong>{filteredEntries.length}</strong></div>
          <div><span>Saldo masuk</span><strong className={styles.amountPositive}>{formatRupiah(totalIn)}</strong></div>
          <div><span>Saldo keluar</span><strong className={styles.amountNegative}>{formatRupiah(totalOut)}</strong></div>
        </div>
        <div className={styles.transactionFilters}>
          <label className={styles.searchField}>Cari transaksi
            <input onChange={(event) => onSearch(event.target.value)} placeholder="Peserta, NISN, catatan, referensi" value={search} />
          </label>
          <label className={styles.field}>Jenis
            <select onChange={(event) => onFilter(event.target.value)} value={filter}>
              <option value="all">Semua jenis</option>
              <option value="deposit">Setoran</option>
              <option value="adjustment">Koreksi saldo</option>
              <option value="withdrawal">Pencairan tunai</option>
              <option value="redemption">Penukaran reward</option>
            </select>
          </label>
          <label className={styles.field}>Dari tanggal<input onChange={(event) => onFrom(event.target.value)} type="date" value={from} /></label>
          <label className={styles.field}>Sampai tanggal<input onChange={(event) => onTo(event.target.value)} type="date" value={to} /></label>
        </div>
        {filteredEntries.length === 0 ? (
          <EmptyState title="Belum ada transaksi" detail="Semua perubahan saldo akan dicatat secara berurutan di sini." />
        ) : (
          <DataTable headers={["Peserta", "Jenis", "Nominal", "Keterangan / referensi", "Dicatat oleh", "Waktu"]}>
            {filteredEntries.map((entry) => (
              <tr key={entry.id}>
                <td>{studentMap.get(entry.studentId)?.name ?? "Tidak ditemukan"}</td>
                <td>{entryName(entry.kind)}</td>
                <td className={entry.amount > 0 ? styles.amountPositive : styles.amountNegative}>{entry.amount > 0 ? "+" : "−"}{formatRupiah(Math.abs(entry.amount))}</td>
                <td>{entry.description}{entry.reference && <small className={styles.transactionReference}>Referensi: {entry.reference}</small>}</td>
                <td>{accountMap.get(entry.createdBy)?.name ?? "Akun tidak ditemukan"}</td>
                <td>{dateTime(entry.createdAt)}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </section>
    </div>
  );
}

function StudentOverview({
  account,
  balance,
  deposits,
  rupiahPerPoint,
  onNavigate,
}: {
  account: LocalAccount;
  balance: number;
  deposits: DepositRequest[];
  rupiahPerPoint: number | null;
  onNavigate: (view: View) => void;
}) {
  const pendingCount = deposits.filter((deposit) => deposit.status === "pending").length;
  return (
    <>
      <div className={styles.statGrid}>
        <Stat label="Poin tersedia" value={`${balance.toLocaleString("id-ID")} poin`} hint="Bertambah setelah setoran disetujui" icon="✳" />
        <Stat label="Total pengajuan" value={String(deposits.length)} hint="Jumlah seluruh setoranmu" icon="↗" />
        <Stat label="Dalam pemeriksaan" value={String(pendingCount)} hint="Menunggu pengelola menimbang" icon="◷" />
      </div>
      <section className={`${styles.card} ${styles.conversionCard}`}>
        <SectionTitle title="Perkiraan nilai poin" />
        <PointRupiahEstimate points={balance} rupiahPerPoint={rupiahPerPoint} />
      </section>
      <section className={styles.card}>
        <div className={styles.sectionTitle}>
          <div><h2>Ajukan setoran sampah</h2><p>Pilih jenis sampah dan unggah foto; berat akan dicatat pengelola.</p></div>
          <button className={styles.smallButton} onClick={() => onNavigate("deposits")} type="button">Buat pengajuan →</button>
        </div>
        {deposits.length === 0 ? (
          <EmptyState title="Belum ada setoran" detail="Setoran yang kamu ajukan dan statusnya akan muncul di sini." />
        ) : (
          <DepositRows deposits={deposits.slice(0, 5)} />
        )}
      </section>
      <p className={styles.greetingNote}>Selamat datang, {account.name}. Poin ditambahkan setelah pengelola menyetujui hasil penimbangan.</p>
    </>
  );
}

function StudentDeposits({
  activeWasteTypes,
  busy,
  deposits,
  onCancelDeposit,
  onPhotoChange,
  onSelectWaste,
  onSubmit,
  photoNames,
  photos,
  selectedIds,
}: {
  activeWasteTypes: WasteType[];
  busy: boolean;
  deposits: DepositRequest[];
  onCancelDeposit: (id: string) => void;
  onPhotoChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onSelectWaste: (id: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  photoNames: string[];
  photos: string[];
  selectedIds: string[];
}) {
  return (
    <div className={styles.twoColumns}>
      <form className={styles.cardForm} onSubmit={onSubmit}>
        <h2>Pengajuan baru</h2>
        <p>Jumlah atau berat aktual akan dicatat pengelola saat pemeriksaan.</p>
        {activeWasteTypes.length === 0 ? (
          <p className={styles.helperBanner}>Belum ada jenis sampah yang tersedia. Hubungi pengelola.</p>
        ) : (
          <fieldset className={styles.wasteChoices}>
            <legend>Pilih jenis sampah</legend>
            {activeWasteTypes.map((item) => (
              <label className={styles.choice} key={item.id}>
                <input checked={selectedIds.includes(item.id)} onChange={() => onSelectWaste(item.id)} type="checkbox" />
                <WasteVisual item={item} />
                <span>{item.name}</span><small>{item.pointsPerUnit.toLocaleString("id-ID")} poin/{wasteUnitLabel(item.unit)}</small>
              </label>
            ))}
          </fieldset>
        )}
        <label className={styles.field}>Foto setoran (maksimal 5)
          <input accept="image/*" disabled={photos.length >= 5} multiple onChange={onPhotoChange} type="file" />
        </label>
        {photoNames.length > 0 && <ul className={styles.photoNames}>{photoNames.map((name, index) => <li key={`${name}-${index}`}>{name}</li>)}</ul>}
        <button className={styles.primaryButton} disabled={busy || activeWasteTypes.length === 0} type="submit">{busy ? "Mengirim…" : "Kirim untuk diperiksa"}</button>
        <p className={styles.formHint}>Foto dikompres sebelum dikirim dan disimpan di server. Pengajuan belum menambah poin.</p>
      </form>
      <section className={styles.card}>
        <SectionTitle title="Riwayat pengajuan" />
        {deposits.length === 0 ? (
          <EmptyState title="Belum ada pengajuan" detail="Pengajuan setoranmu akan tercatat di sini." />
        ) : (
          <DepositRows deposits={deposits} onCancel={onCancelDeposit} />
        )}
      </section>
    </div>
  );
}

function DepositRows({
  deposits,
  onCancel,
}: {
  deposits: DepositRequest[];
  onCancel?: (id: string) => void;
}) {
  return (
    <div className={styles.depositList}>
      {deposits.map((deposit) => (
        <article className={styles.depositRow} key={deposit.id}>
          <div>
            <strong>{deposit.lines.map((line) => line.wasteTypeName).join(", ")}</strong>
            <small>{dateTime(deposit.createdAt)} · {deposit.photos.length} foto</small>
            {deposit.note && <small>Catatan: {deposit.note}</small>}
          </div>
          <div className={styles.depositStatus}>
            <StatusBadge status={deposit.status} />
            {deposit.status === "approved" && (
              <strong>
                {deposit.lines.some((line) => line.pointsAwarded !== undefined)
                  ? `${deposit.lines.reduce((sum, line) => sum + (line.pointsAwarded ?? 0), 0).toLocaleString("id-ID")} poin`
                  : "Setoran lama"}
              </strong>
            )}
            {deposit.status === "pending" && onCancel && (
              <button className={styles.textButton} onClick={() => onCancel(deposit.id)} type="button">Batalkan</button>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}

function StudentPoints({
  total,
  available,
  entries,
  rupiahPerPoint,
}: {
  total: number;
  available: number;
  entries: PointEntry[];
  rupiahPerPoint: number | null;
}) {
  return (
    <>
      <section className={`${styles.card} ${styles.balanceBanner}`}>
        <div>
          <p>Poin saat ini</p>
          <strong>{total.toLocaleString("id-ID")} poin</strong>
          <small>Tersedia untuk ditukar: {available.toLocaleString("id-ID")} poin</small>
          <PointRupiahEstimate points={available} rupiahPerPoint={rupiahPerPoint} />
        </div>
      </section>
      <section className={styles.card}>
        <SectionTitle title="Riwayat poin" />
        {entries.length === 0 ? (
          <EmptyState title="Belum ada riwayat poin" detail="Poin dari setoran yang disetujui dan penukaran akan tercatat di sini." />
        ) : (
          <DataTable headers={["Keterangan", "Poin", "Waktu"]}>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td>{entry.description}</td>
                <td className={entry.amount > 0 ? styles.amountPositive : styles.amountNegative}>{entry.amount > 0 ? "+" : "−"}{Math.abs(entry.amount).toLocaleString("id-ID")} poin</td>
                <td>{dateTime(entry.createdAt)}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </section>
    </>
  );
}

function PointRupiahEstimate({
  points,
  rupiahPerPoint,
}: {
  points: number;
  rupiahPerPoint: number | null;
}) {
  if (rupiahPerPoint === null) {
    return <p className={styles.conversionEstimate}>Nilai rupiah per poin belum ditetapkan pengelola.</p>;
  }
  const rupiahValue = getPointsRupiahValue(points, rupiahPerPoint);
  if (rupiahValue === null) {
    return <p className={styles.conversionEstimate}>Nilai rupiah per poin belum ditetapkan pengelola.</p>;
  }
  const pointsForTenThousand = Math.ceil(10_000 / rupiahPerPoint);
  return (
    <div className={styles.conversionEstimate}>
      <strong>{formatRupiah(rupiahValue)}</strong>
      <p>Perkiraan untuk {points.toLocaleString("id-ID")} poin tersedia · Rp10.000 memerlukan sekitar {pointsForTenThousand.toLocaleString("id-ID")} poin ({formatRupiah(rupiahPerPoint)} per poin).</p>
    </div>
  );
}

function withdrawalStatusName(status: WithdrawalRequest["status"]) {
  return {
    pending: "Menunggu persetujuan",
    processing: "Proses pencairan",
    paid: "Sudah ditransfer",
    rejected: "Ditolak",
    cancelled: "Dibatalkan",
  }[status];
}

function WithdrawalStatus({ status }: { status: WithdrawalRequest["status"] }) {
  const className = {
    pending: styles.statusPending,
    processing: styles.statusProcessing,
    paid: styles.statusApproved,
    rejected: styles.statusRejected,
    cancelled: styles.statusMuted,
  }[status];
  return <span className={`${styles.status} ${className}`}>{withdrawalStatusName(status)}</span>;
}

function StudentWithdrawals({
  requests,
  available,
  reserved,
  maxAmount,
  editingId,
  amount,
  withdrawAll,
  destinationType,
  institution,
  accountName,
  accountNumber,
  onAmount,
  onWithdrawAll,
  onDestinationType,
  onInstitution,
  onAccountName,
  onAccountNumber,
  onSubmit,
  onEdit,
  onCancel,
  onReset,
  managerWhatsapp,
}: {
  requests: WithdrawalRequest[];
  available: number;
  reserved: number;
  maxAmount: number;
  editingId: string;
  amount: string;
  withdrawAll: boolean;
  destinationType: "bank" | "ewallet";
  institution: string;
  accountName: string;
  accountNumber: string;
  onAmount: (value: string) => void;
  onWithdrawAll: (value: boolean) => void;
  onDestinationType: (value: "bank" | "ewallet") => void;
  onInstitution: (value: string) => void;
  onAccountName: (value: string) => void;
  onAccountNumber: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onEdit: (request: WithdrawalRequest) => void;
  onCancel: (requestId: string) => void;
  onReset: () => void;
  managerWhatsapp: string;
}) {
  const currentActiveRequest = requests.find(
    (request) => request.status === "pending" || request.status === "processing",
  );
  return (
    <div className={styles.twoColumns}>
      {!currentActiveRequest || currentActiveRequest.status === "pending" ? (
        <form className={styles.cardForm} onSubmit={onSubmit}>
          <h2>{editingId ? "Ubah pengajuan" : "Ajukan pencairan saldo"}</h2>
          <p>
            Isi nominal dan rekening tujuan. Setelah dikirim, WhatsApp pengelola akan terbuka dan
            pengajuan tersimpan di riwayat.
          </p>
          <div className={styles.withdrawalBalance}>
            <span>Saldo tersedia</span>
            <strong>{formatRupiah(available)}</strong>
            {reserved > 0 && <small>{formatRupiah(reserved)} sedang ditahan pada pengajuan lain.</small>}
          </div>
          <label className={styles.field}>
            Nominal pencairan (Rp)
            <input
              max={maxAmount}
              min="1"
              onChange={(event) => {
                onWithdrawAll(false);
                onAmount(event.target.value);
              }}
              placeholder="Masukkan nominal"
              required={!withdrawAll}
              step="1"
              type="number"
              value={withdrawAll ? maxAmount : amount}
            />
          </label>
          <label className={styles.checkField}>
            <input
              checked={withdrawAll}
              disabled={maxAmount <= 0}
              onChange={(event) => {
                onWithdrawAll(event.target.checked);
                if (event.target.checked) onAmount(String(maxAmount));
              }}
              type="checkbox"
            />
            Tarik semua saldo tersedia ({formatRupiah(maxAmount)})
          </label>
          <label className={styles.field}>
            Jenis tujuan
            <select
              onChange={(event) => onDestinationType(event.target.value as "bank" | "ewallet")}
              value={destinationType}
            >
              <option value="bank">Rekening bank</option>
              <option value="ewallet">E-wallet</option>
            </select>
          </label>
          <label className={styles.field}>
            {destinationType === "bank" ? "Nama bank" : "Nama e-wallet"}
            <input
              maxLength={60}
              onChange={(event) => onInstitution(event.target.value)}
              placeholder={destinationType === "bank" ? "Contoh: BCA" : "Contoh: GoPay"}
              required
              value={institution}
            />
          </label>
          <label className={styles.field}>
            Nama pemilik rekening
            <input maxLength={100} onChange={(event) => onAccountName(event.target.value)} required value={accountName} />
          </label>
          <label className={styles.field}>
            Nomor rekening/e-wallet
            <input
              autoComplete="off"
              inputMode="numeric"
              maxLength={24}
              onChange={(event) => onAccountNumber(event.target.value.replace(/\D/g, "").slice(0, 24))}
              pattern="[0-9]{6,24}"
              placeholder="6–24 digit"
              required
              value={accountNumber}
            />
          </label>
          <div className={styles.buttonRow}>
            <button className={styles.primaryButton} disabled={available <= 0 || maxAmount <= 0} type="submit">
              {editingId ? "Simpan perubahan" : "Kirim pengajuan"}
            </button>
            {editingId && <button className={styles.secondaryButton} onClick={onReset} type="button">Batal edit</button>}
          </div>
          <p className={styles.formHint}>Saldo akan ditahan sampai pengajuan ditolak, dibatalkan, atau transfer selesai.</p>
        </form>
      ) : (
        <section className={styles.cardForm}>
          <h2>Pengajuan sedang diproses</h2>
          <p>Satu pengajuan aktif per peserta. Pengajuan baru dapat dibuat setelah proses ini selesai.</p>
          <WithdrawalSummary request={currentActiveRequest} />
        </section>
      )}
      <section className={styles.card}>
        <SectionTitle title="Riwayat pengajuan pencairan" />
        {requests.length === 0 ? (
          <EmptyState title="Belum ada pengajuan" detail="Pengajuan pencairan dan statusnya akan tercatat di sini." />
        ) : (
          <div className={styles.withdrawalList}>
            {requests.map((request) => (
              <article className={styles.withdrawalRow} key={request.id}>
                <div className={styles.withdrawalRowHeading}>
                  <div><strong>{formatRupiah(request.amount)}</strong><small>{request.institution} · {maskAccountNumber(request.accountNumber)}</small></div>
                  <WithdrawalStatus status={request.status} />
                </div>
                <small>Diajukan {dateTime(request.createdAt)}</small>
                {request.note && <p className={styles.withdrawalNote}>Catatan admin: {request.note}</p>}
                {request.status === "pending" && (
                  <div className={styles.buttonRow}>
                    <button className={styles.smallButton} onClick={() => onEdit(request)} type="button">Edit</button>
                    <button className={styles.textButton} onClick={() => onCancel(request.id)} type="button">Batalkan pengajuan</button>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
        {managerWhatsapp && (
          <p className={styles.formHint}>Setelah pengajuan dikirim, WhatsApp pengelola terbuka otomatis.</p>
        )}
      </section>
    </div>
  );
}

function WithdrawalSummary({ request }: { request: WithdrawalRequest }) {
  return (
    <div className={styles.withdrawalSummary}>
      <WithdrawalStatus status={request.status} />
      <strong>{formatRupiah(request.amount)}</strong>
      <span>{request.destinationType === "bank" ? "Bank" : "E-wallet"} · {request.institution}</span>
      <span>{request.accountName} · {maskAccountNumber(request.accountNumber)}</span>
      <small>Diajukan {dateTime(request.createdAt)}</small>
    </div>
  );
}

function ManagerWithdrawals({
  requests,
  students,
  filter,
  onFilter,
  selected,
  onOpen,
  onClose,
  note,
  onNote,
  onApprove,
  onReject,
  onMarkPaid,
}: {
  requests: WithdrawalRequest[];
  students: LocalAccount[];
  filter: string;
  onFilter: (filter: string) => void;
  selected?: WithdrawalRequest;
  onOpen: (request: WithdrawalRequest) => void;
  onClose: () => void;
  note: string;
  onNote: (value: string) => void;
  onApprove: () => void;
  onReject: () => void;
  onMarkPaid: (requestId: string) => void;
}) {
  const studentMap = new Map(students.map((student) => [student.id, student]));
  return (
    <>
      <section className={styles.card}>
        <div className={styles.toolbar}>
          <label className={styles.filterLabel}>
            Status pengajuan
            <select onChange={(event) => onFilter(event.target.value)} value={filter}>
              <option value="active">Aktif</option>
              <option value="pending">Menunggu persetujuan</option>
              <option value="processing">Proses pencairan</option>
              <option value="paid">Sudah ditransfer</option>
              <option value="rejected">Ditolak</option>
              <option value="cancelled">Dibatalkan</option>
              <option value="all">Semua riwayat</option>
            </select>
          </label>
          <span className={styles.resultCount}>{requests.length} pengajuan</span>
        </div>
        {requests.length === 0 ? (
          <EmptyState title="Tidak ada pengajuan pencairan" detail="Pengajuan peserta akan muncul di sini." />
        ) : (
          <DataTable headers={["Peserta", "Nominal", "Tujuan transfer", "Diajukan", "Status", "Aksi"]}>
            {requests.map((request) => (
              <tr key={request.id}>
                <td><strong>{studentMap.get(request.studentId)?.name ?? "Peserta tidak ditemukan"}</strong><small>{studentMap.get(request.studentId)?.identifier ?? ""}</small></td>
                <td>{formatRupiah(request.amount)}</td>
                <td>{request.institution}<small>{request.accountName} · {maskAccountNumber(request.accountNumber)}</small></td>
                <td>{dateTime(request.createdAt)}</td>
                <td><WithdrawalStatus status={request.status} /></td>
                <td><button className={styles.smallButton} onClick={() => onOpen(request)} type="button">Detail</button></td>
              </tr>
            ))}
          </DataTable>
        )}
      </section>
      {selected && (
        <section className={styles.card}>
          <div className={styles.sectionTitle}>
            <div><h2>Detail pengajuan</h2><p>{studentMap.get(selected.studentId)?.name ?? "Peserta"} · {dateTime(selected.createdAt)}</p></div>
            <button className={styles.textButton} onClick={onClose} type="button">Tutup</button>
          </div>
          <WithdrawalSummary request={selected} />
          {studentMap.get(selected.studentId)?.whatsapp && (
            <a
              className={styles.secondaryButton}
              href={whatsappUrl(
                studentMap.get(selected.studentId)?.whatsapp ?? "",
                `Halo ${studentMap.get(selected.studentId)?.name ?? ""}, saya admin Bank Sampah terkait pengajuan pencairan ${formatRupiah(selected.amount)}.`,
              )}
              rel="noreferrer"
              target="_blank"
            >
              Hubungi peserta via WhatsApp
            </a>
          )}
          {selected.status === "pending" && (
            <div className={styles.reviewForm}>
              <label className={styles.field}>
                Catatan persetujuan atau alasan penolakan
                <textarea maxLength={240} onChange={(event) => onNote(event.target.value)} placeholder="Alasan wajib diisi jika menolak" value={note} />
              </label>
              <div className={styles.buttonRow}>
                <button className={styles.primaryButton} onClick={onApprove} type="button">Setujui & proses transfer</button>
                <button className={styles.dangerButton} disabled={!note.trim()} onClick={onReject} type="button">Tolak pengajuan</button>
              </div>
              <p className={styles.formHint}>Setelah disetujui, peserta tidak dapat mengubah atau membatalkan pengajuan.</p>
            </div>
          )}
          {selected.status === "processing" && (
            <div className={styles.reviewForm}>
              <p className={styles.formHint}>Lakukan transfer manual ke tujuan di atas. Setelah transfer berhasil, tandai pengajuan selesai.</p>
              <button className={styles.primaryButton} onClick={() => onMarkPaid(selected.id)} type="button">Transfer selesai — catat pencairan</button>
            </div>
          )}
          {selected.note && <p className={styles.withdrawalNote}>Catatan: {selected.note}</p>}
        </section>
      )}
    </>
  );
}

function TransactionRows({
  entries,
  students,
}: {
  entries: BusinessData["walletEntries"];
  students: LocalAccount[];
}) {
  const studentMap = new Map(students.map((student) => [student.id, student]));
  return (
    <div className={styles.depositList}>
      {entries.map((entry) => (
        <article className={styles.depositRow} key={entry.id}>
          <div><strong>{studentMap.get(entry.studentId)?.name ?? "Peserta"}</strong><small>{entryName(entry.kind)} · {entry.description}</small></div>
          <strong className={entry.amount > 0 ? styles.amountPositive : styles.amountNegative}>{entry.amount > 0 ? "+" : "−"}{formatRupiah(Math.abs(entry.amount))}</strong>
        </article>
      ))}
    </div>
  );
}

function ProfileMenuItem({
  icon,
  title,
  detail,
  onClick,
}: {
  icon: string;
  title: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button className={styles.profileMenuItem} onClick={onClick} type="button">
      <span className={styles.profileMenuIcon} aria-hidden="true">{icon}</span>
      <span className={styles.profileMenuText}><strong>{title}</strong><small>{detail}</small></span>
      <span className={styles.profileMenuArrow} aria-hidden="true">›</span>
    </button>
  );
}

function ProfileDetails({
  account,
  onSave,
}: {
  account: LocalAccount;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form className={styles.settingsCard} onSubmit={onSave}>
      <div className={styles.profileCard}>
        <div className={styles.profileAvatar}>{account.name.trim().charAt(0).toUpperCase()}</div>
        <div><h2>{account.name}</h2><p>{account.role === "manager" ? "Pengelola" : "Peserta didik"}</p></div>
      </div>
      <div className={styles.profileFormGrid}>
        <label className={styles.field}>
          Nama lengkap
          <input defaultValue={account.name} maxLength={100} name="name" required />
        </label>
        <label className={styles.field}>
          {account.role === "manager" ? "Nama pengguna" : "NISN"}
          <input disabled value={account.identifier} />
          <small className={styles.fieldHint}>Identitas masuk tidak dapat diubah dari prototipe.</small>
        </label>
        {account.role === "student" && (
          <label className={styles.field}>
            Kelas
            <input defaultValue={account.className ?? ""} maxLength={30} name="className" required />
          </label>
        )}
        <label className={styles.field}>
          Nomor WhatsApp
          <input defaultValue={account.whatsapp} maxLength={24} name="whatsapp" required type="tel" />
        </label>
      </div>
      <button className={styles.primaryButton} type="submit">Simpan data akun</button>
    </form>
  );
}

function SecuritySettings({ onSave }: { onSave: (event: FormEvent<HTMLFormElement>) => void }) {
  return (
    <form className={styles.settingsCard} onSubmit={onSave}>
      <div className={styles.settingsIntro}>
        <span className={styles.settingsIcon}>♧</span>
        <div><h2>Ubah kata sandi</h2><p>Gunakan kata sandi baru minimal 8 karakter.</p></div>
      </div>
      <div className={styles.profileFormGrid}>
        <label className={styles.field}>
          Kata sandi saat ini
          <input autoComplete="current-password" minLength={8} name="currentPassword" required type="password" />
        </label>
        <span />
        <label className={styles.field}>
          Kata sandi baru
          <input autoComplete="new-password" minLength={8} name="newPassword" required type="password" />
        </label>
        <label className={styles.field}>
          Ulangi kata sandi baru
          <input autoComplete="new-password" minLength={8} name="confirmPassword" required type="password" />
        </label>
      </div>
      <p className={styles.settingsWarning}>Kata sandi diperbarui dengan aman melalui server.</p>
      <button className={styles.primaryButton} type="submit">Perbarui kata sandi</button>
    </form>
  );
}

function SettingsOptions({
  manager,
  notificationsEnabled,
  onConversion,
  onContact,
  onPreferences,
  onHelp,
}: {
  manager: boolean;
  notificationsEnabled: boolean;
  onConversion: () => void;
  onContact: () => void;
  onPreferences: () => void;
  onHelp: () => void;
}) {
  return (
    <section className={styles.settingsMenuCard}>
      <p className={styles.profileMenuHeading}>PREFERENSI</p>
      {manager && (
        <ProfileMenuItem icon="↗" title="Nomor WhatsApp pengelola" detail="Kontak yang digunakan peserta untuk menghubungi pengelola" onClick={onContact} />
      )}
      {manager && (
        <ProfileMenuItem
          icon="⇄"
          title="Nilai konversi poin"
          detail="Atur perkiraan nilai rupiah setiap poin"
          onClick={onConversion}
        />
      )}
      <ProfileMenuItem
        icon="♧"
        title="Notifikasi dalam website"
        detail={`Saat ini ${notificationsEnabled ? "aktif" : "nonaktif"}`}
        onClick={onPreferences}
      />
      <p className={styles.profileMenuHeading}>PENYIMPANAN</p>
      <ProfileMenuItem icon="◈" title="Penyimpanan data" detail="Informasi data akun dan aktivitas" onClick={onHelp} />
      <div className={styles.settingsInlineInfo}>
        Data akun dan aktivitas tersimpan di server dan tersedia saat kamu masuk dari perangkat lain.
      </div>
    </section>
  );
}

function ConversionRateSettings({
  rupiahPerPoint,
  onSave,
}: {
  rupiahPerPoint: number | null;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const pointsForTenThousand = rupiahPerPoint === null
    ? null
    : Math.ceil(10_000 / rupiahPerPoint);
  return (
    <form className={styles.settingsCard} onSubmit={onSave}>
      <div className={styles.settingsIntro}>
        <span className={styles.settingsIcon}>⇄</span>
        <div>
          <h2>Nilai konversi poin</h2>
          <p>Tetapkan perkiraan nilai rupiah yang ditampilkan bersama poin peserta.</p>
        </div>
      </div>
      <label className={styles.field}>
        Nilai 1 poin (Rp)
        <input
          defaultValue={rupiahPerPoint ?? ""}
          min="1"
          name="rupiahPerPoint"
          placeholder="Contoh: 10"
          required
          step="1"
          type="number"
        />
        <small className={styles.fieldHint}>Contoh: isi 10 untuk menetapkan 1 poin setara perkiraan Rp10.</small>
      </label>
      {rupiahPerPoint === null ? (
        <p className={styles.settingsWarning}>Nilai konversi belum diatur. Peserta belum akan melihat perkiraan nominal rupiah.</p>
      ) : (
        <p className={styles.settingsWarning}>
          Nilai saat ini: 1 poin = {formatRupiah(rupiahPerPoint)}. Target Rp10.000 memerlukan sekitar {pointsForTenThousand?.toLocaleString("id-ID")} poin.
          {" "}Pengaturan ini hanya menampilkan perkiraan, bukan saldo uang yang dapat dicairkan.
        </p>
      )}
      <button className={styles.primaryButton} type="submit">Simpan nilai konversi</button>
    </form>
  );
}

function ManagerContactSettings({
  manager,
  whatsapp,
  onSave,
  onHelp,
}: {
  manager: boolean;
  whatsapp: string;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  onHelp: () => void;
}) {
  if (!manager) {
    return (
      <section className={styles.settingsCard}>
        <div className={styles.settingsIntro}>
          <span className={styles.settingsIcon}>↗</span>
          <div><h2>Kontak pengelola</h2><p>Hubungi pengelola melalui WhatsApp untuk menanyakan setoran atau penukaran reward.</p></div>
        </div>
        {whatsapp ? (
          <a
            className={styles.primaryButton}
            href={whatsappUrl(whatsapp, "Halo pengelola, saya ingin bertanya tentang Bank Sampah Sekolah Merdeka.")}
            rel="noreferrer"
            target="_blank"
          >
            Buka WhatsApp pengelola
          </a>
        ) : (
          <p className={styles.settingsWarning}>Nomor WhatsApp pengelola belum diatur.</p>
        )}
        <button className={styles.textButton} onClick={onHelp} type="button">Tentang penyimpanan data</button>
      </section>
    );
  }

  return (
    <form className={styles.settingsCard} onSubmit={onSave}>
      <div className={styles.settingsIntro}>
        <span className={styles.settingsIcon}>↗</span>
        <div><h2>Nomor WhatsApp pengelola</h2><p>Peserta akan memakai nomor ini saat menghubungi pengelola.</p></div>
      </div>
      <label className={styles.field}>
        Nomor WhatsApp aktif
        <input
          defaultValue={whatsapp}
          maxLength={24}
          name="managerWhatsapp"
          placeholder="Contoh: 081234567890"
          required
          type="tel"
        />
      </label>
      <p className={styles.settingsWarning}>Perubahan tersimpan di server dan digunakan pada tautan WhatsApp peserta.</p>
      <button className={styles.primaryButton} type="submit">Simpan nomor kontak</button>
    </form>
  );
}

function NotificationPreferences({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <section className={styles.settingsMenuCard}>
      <p className={styles.profileMenuHeading}>NOTIFIKASI DI DALAM WEBSITE</p>
      <label className={styles.preferenceToggle}>
        <span>
          <strong>Aktifkan notifikasi</strong>
          <small>Beritahu aktivitas setoran, poin, dan penukaran reward.</small>
        </span>
        <input checked={enabled} onChange={(event) => onChange(event.target.checked)} type="checkbox" />
      </label>
      <p className={styles.settingsWarning}>Preferensi tersimpan di server. Notifikasi email dan WhatsApp otomatis belum tersedia.</p>
    </section>
  );
}

function BusinessDataHelp() {
  return (
    <section className={styles.settingsCard}>
      <div className={styles.settingsIntro}>
        <span className={styles.settingsIcon}>◈</span>
        <div><h2>Tentang penyimpanan data</h2><p>Data akun dan aktivitas Bank Sampah disimpan di server.</p></div>
      </div>
      <ul className={styles.helpList}>
        <li>Profil akun, setoran, poin, reward, penukaran, jadwal, notifikasi, foto, dan preferensi tersimpan di server.</li>
        <li>Data tersedia setelah masuk ke akun dari perangkat yang berbeda.</li>
        <li>Browser hanya menyimpan informasi sementara yang diperlukan untuk menjalankan aplikasi.</li>
      </ul>
    </section>
  );
}
