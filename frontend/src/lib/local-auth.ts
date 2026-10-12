export type AccountRole = "student" | "manager";

export type AccountProfile = {
  id: string;
  role: AccountRole;
  name: string;
  identifier: string;
  className: string | null;
  whatsapp: string;
  active: boolean;
  passwordChangeRequired: boolean;
  createdAt: string;
};

export type LocalAccount = AccountProfile & {
  salt: string;
  passwordHash: string;
};

const accountCache = new Map<string, LocalAccount>();

export function getLocalAccounts() {
  return [...accountCache.values()];
}

export function cacheServerAccount(account: AccountProfile) {
  const snapshot: LocalAccount = { ...account, salt: "", passwordHash: "" };
  accountCache.set(snapshot.id, snapshot);
  return snapshot;
}

export function cacheServerAccounts(accounts: AccountProfile[]) {
  const serverIds = new Set(accounts.map((account) => account.id));
  for (const [id, account] of accountCache) {
    if (account.role === "student" && !serverIds.has(id)) accountCache.delete(id);
  }
  for (const account of accounts) cacheServerAccount(account);
  return getLocalAccounts();
}

export function clearLegacyLocalAuthData() {
  window.localStorage.removeItem("sekolah-merdeka-bank-sampah:accounts:v1");
  window.localStorage.removeItem("sekolah-merdeka-bank-sampah:session:v1");
}
