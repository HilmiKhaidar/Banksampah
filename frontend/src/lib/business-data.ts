export type WasteUnit = "kg" | "liter";
export type HistoricalWasteUnit = WasteUnit | "buah";

export type WasteType = {
  id: string;
  name: string;
  unit: HistoricalWasteUnit;
  pointsPerUnit: number;
  pricePerUnit?: number;
  pricePerKg?: number;
  icon?: string;
  image?: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type DepositLine = {
  wasteTypeId: string;
  wasteTypeName: string;
  unit: HistoricalWasteUnit;
  quantity: number | null;
  pricePerUnit: number | null;
  weightKg?: number | null;
  pricePerKg?: number | null;
  amount: number | null;
  pointsAwarded?: number | null;
};

export type PointEntry = {
  id: string;
  studentId: string;
  amount: number;
  description: string;
  depositId: string | null;
  redemptionId: string | null;
  createdAt: string;
  createdBy: string;
};

export type Reward = {
  id: string;
  name: string;
  description: string;
  kind: "item" | "money";
  pointsCost: number;
  stock: number | null;
  moneyAmount: number | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type RedemptionStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "fulfilled"
  | "cancelled";

export type RedemptionRequest = {
  id: string;
  studentId: string;
  rewardId: string;
  rewardName: string;
  kind: Reward["kind"];
  pointsCost: number;
  moneyAmount: number | null;
  status: RedemptionStatus;
  note: string;
  createdAt: string;
  updatedAt: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  fulfilledBy: string | null;
  fulfilledAt: string | null;
};

export type DepositStatus = "pending" | "approved" | "rejected" | "cancelled";

export type DepositRequest = {
  id: string;
  studentId: string;
  lines: DepositLine[];
  photos: string[];
  photoCount?: number;
  status: DepositStatus;
  note: string;
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
};

export type WalletEntry = {
  id: string;
  studentId: string;
  kind: "deposit" | "adjustment" | "withdrawal" | "redemption";
  amount: number;
  description: string;
  reference?: string;
  depositId: string | null;
  createdAt: string;
  createdBy: string;
};

export type BusinessNotification = {
  id: string;
  recipientId: string;
  title: string;
  message: string;
  kind: "deposit" | "wallet" | "reward" | "system";
  relatedId: string | null;
  createdAt: string;
  readAt: string | null;
};

export type WithdrawalStatus =
  | "pending"
  | "processing"
  | "paid"
  | "rejected"
  | "cancelled";

export type WithdrawalRequest = {
  id: string;
  studentId: string;
  amount: number;
  destinationType: "bank" | "ewallet";
  institution: string;
  accountName: string;
  accountNumber: string;
  status: WithdrawalStatus;
  note: string;
  createdAt: string;
  updatedAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  paidAt: string | null;
  paidBy: string | null;
};

export type BusinessData = {
  wasteTypes: WasteType[];
  deposits: DepositRequest[];
  walletEntries: WalletEntry[];
  pointEntries: PointEntry[];
  rewards: Reward[];
  redemptionRequests: RedemptionRequest[];
  notifications: BusinessNotification[];
  withdrawalRequests: WithdrawalRequest[];
};

export type BusinessSettings = {
  managerWhatsapp: string;
  inAppNotifications: boolean;
  rupiahPerPoint: number | null;
};

export function getStudentBalance(data: BusinessData, studentId: string) {
  return data.walletEntries
    .filter((entry) => entry.studentId === studentId)
    .reduce((balance, entry) => balance + entry.amount, 0);
}

export function getStudentPoints(data: BusinessData, studentId: string) {
  return data.pointEntries
    .filter((entry) => entry.studentId === studentId)
    .reduce((total, entry) => total + entry.amount, 0);
}

export function getStudentAvailablePoints(data: BusinessData, studentId: string) {
  const reserved = data.redemptionRequests
    .filter((request) => request.studentId === studentId && request.status === "pending")
    .reduce((total, request) => total + request.pointsCost, 0);
  return getStudentPoints(data, studentId) - reserved;
}

export function getStudentReservedBalance(data: BusinessData, studentId: string) {
  return data.withdrawalRequests
    .filter(
      (request) =>
        request.studentId === studentId &&
        (request.status === "pending" || request.status === "processing"),
    )
    .reduce((total, request) => total + request.amount, 0);
}

export function getStudentAvailableBalance(data: BusinessData, studentId: string) {
  return getStudentBalance(data, studentId) - getStudentReservedBalance(data, studentId);
}

export function maskAccountNumber(accountNumber: string) {
  return accountNumber.length <= 4
    ? accountNumber
    : `${"•".repeat(Math.min(accountNumber.length - 4, 8))}${accountNumber.slice(-4)}`;
}

export function formatRupiah(amount: number | bigint) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function getPointsRupiahValue(points: number, rupiahPerPoint: number | null) {
  return rupiahPerPoint === null ? null : BigInt(points) * BigInt(rupiahPerPoint);
}
