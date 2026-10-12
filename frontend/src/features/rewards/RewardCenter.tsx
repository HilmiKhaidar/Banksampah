"use client";

import { FormEvent, useState } from "react";
import { DataTable, EmptyState, SectionTitle } from "@/components/ui/WorkspacePrimitives";
import type {
  BusinessData,
  RedemptionRequest,
  Reward,
} from "@/lib/business-data";
import type { LocalAccount } from "@/lib/local-auth";
import styles from "@/features/workspace/Workspace.module.css";

export type RewardInput = {
  name: string;
  description: string;
  kind: Reward["kind"];
  pointsCost: number;
  stock: number | null;
  moneyAmount: number | null;
};

function points(value: number) {
  return `${value.toLocaleString("id-ID")} poin`;
}

function rewardStatus(status: RedemptionRequest["status"]) {
  return {
    pending: "Menunggu",
    approved: "Disetujui",
    rejected: "Ditolak",
    fulfilled: "Selesai",
    cancelled: "Dibatalkan",
  }[status];
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function RewardCenter({
  mode,
  data,
  accountId,
  students,
  availablePoints,
  onCreate,
  onUpdate,
  onRequest,
  onReview,
  onFulfill,
}: {
  mode: "catalog" | "requests" | "student";
  data: BusinessData;
  accountId: string;
  students: LocalAccount[];
  availablePoints: number;
  onCreate: (input: RewardInput) => boolean | Promise<boolean>;
  onUpdate: (id: string, input: RewardInput & { active: boolean }) => boolean | Promise<boolean>;
  onRequest: (rewardId: string) => void | Promise<void>;
  onReview: (requestId: string, decision: "approve" | "reject", note: string) => void | Promise<void>;
  onFulfill: (requestId: string) => void | Promise<void>;
}) {
  const [editing, setEditing] = useState<Reward | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<Reward["kind"]>("item");
  const [pointsCost, setPointsCost] = useState("");
  const [stock, setStock] = useState("");
  const [moneyAmount, setMoneyAmount] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [requestFilter, setRequestFilter] = useState("pending");
  const [busy, setBusy] = useState(false);

  function resetForm() {
    setEditing(null);
    setName("");
    setDescription("");
    setKind("item");
    setPointsCost("");
    setStock("");
    setMoneyAmount("");
  }

  function editReward(reward: Reward) {
    setEditing(reward);
    setName(reward.name);
    setDescription(reward.description);
    setKind(reward.kind);
    setPointsCost(String(reward.pointsCost));
    setStock(reward.stock === null ? "" : String(reward.stock));
    setMoneyAmount(reward.moneyAmount === null ? "" : String(reward.moneyAmount));
  }

  async function submitReward(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const input: RewardInput = {
      name,
      description,
      kind,
      pointsCost: Number(pointsCost),
      stock: kind === "item" && stock.trim() ? Number(stock) : null,
      moneyAmount: kind === "money" ? Number(moneyAmount) : null,
    };
    setBusy(true);
    try {
      const saved = await (editing
        ? onUpdate(editing.id, { ...input, active: editing.active })
        : onCreate(input));
      if (saved) resetForm();
    } finally {
      setBusy(false);
    }
  }

  async function performBusyAction(action: () => void | Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  if (mode === "catalog") {
    return (
      <div className={styles.twoColumns}>
        <section className={styles.card}>
          <SectionTitle title="Katalog reward" />
          {data.rewards.length === 0 ? (
            <EmptyState title="Katalog masih kosong" detail="Tambahkan reward barang atau uang untuk peserta." />
          ) : (
            <DataTable headers={["Reward", "Biaya", "Stok", "Status", "Aksi"]}>
              {data.rewards.map((reward) => (
                <tr key={reward.id}>
                  <td>
                    <strong>{reward.name}</strong>
                    <small>{reward.kind === "money" ? `Uang tunai · Rp${(reward.moneyAmount ?? 0).toLocaleString("id-ID")}` : reward.description || "Reward barang"}</small>
                  </td>
                  <td>{points(reward.pointsCost)}</td>
                  <td>{reward.kind === "money" ? "—" : reward.stock === null ? "Tidak terbatas" : reward.stock}</td>
                  <td><span className={`${styles.status} ${reward.active ? styles.statusApproved : styles.statusMuted}`}>{reward.active ? "Aktif" : "Nonaktif"}</span></td>
                  <td>
                    <div className={styles.tableActions}>
                      <button className={styles.smallButton} onClick={() => editReward(reward)} type="button">Edit</button>
                      <button
                        className={styles.textButton}
                        disabled={busy}
                        onClick={() => void performBusyAction(async () => {
                          await onUpdate(reward.id, {
                          name: reward.name,
                          description: reward.description,
                          kind: reward.kind,
                          pointsCost: reward.pointsCost,
                          stock: reward.stock,
                          moneyAmount: reward.moneyAmount,
                          active: !reward.active,
                          });
                        })}
                        type="button"
                      >
                        {reward.active ? "Nonaktifkan" : "Aktifkan"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </DataTable>
          )}
        </section>
        <form className={styles.cardForm} onSubmit={submitReward}>
          <h2>{editing ? "Ubah reward" : "Tambah reward"}</h2>
          <p>Tetapkan hadiah dan jumlah poin yang dibutuhkan. Penyerahan dilakukan manual oleh pengelola.</p>
          <label className={styles.field}>Nama reward
            <input maxLength={100} onChange={(event) => setName(event.target.value)} required value={name} />
          </label>
          <label className={styles.field}>Jenis reward
            <select onChange={(event) => setKind(event.target.value as Reward["kind"])} value={kind}>
              <option value="item">Barang</option>
              <option value="money">Uang</option>
            </select>
          </label>
          {kind === "item" ? (
            <>
              <label className={styles.field}>Deskripsi barang
                <textarea maxLength={300} onChange={(event) => setDescription(event.target.value)} value={description} />
              </label>
              <label className={styles.field}>Stok barang (kosongkan jika tidak terbatas)
                <input min="0" onChange={(event) => setStock(event.target.value)} step="1" type="number" value={stock} />
              </label>
            </>
          ) : (
            <label className={styles.field}>Nominal uang (Rp)
              <input min="1" onChange={(event) => setMoneyAmount(event.target.value)} required step="1" type="number" value={moneyAmount} />
            </label>
          )}
          <label className={styles.field}>Biaya penukaran (poin)
            <input min="1" onChange={(event) => setPointsCost(event.target.value)} required step="1" type="number" value={pointsCost} />
          </label>
          <div className={styles.buttonRow}>
            <button className={styles.primaryButton} disabled={busy} type="submit">{editing ? "Simpan perubahan" : "Tambah katalog"}</button>
            {editing && <button className={styles.secondaryButton} disabled={busy} onClick={resetForm} type="button">Batal</button>}
          </div>
        </form>
      </div>
    );
  }

  if (mode === "requests") {
    const studentMap = new Map(students.map((student) => [student.id, student]));
    const requests = data.redemptionRequests
      .filter((request) => requestFilter === "all" || request.status === requestFilter)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return (
      <section className={styles.card}>
        <div className={styles.toolbar}>
          <label className={styles.filterLabel}>Status
            <select onChange={(event) => setRequestFilter(event.target.value)} value={requestFilter}>
              <option value="pending">Menunggu</option>
              <option value="approved">Disetujui</option>
              <option value="rejected">Ditolak</option>
              <option value="fulfilled">Selesai</option>
              <option value="all">Semua</option>
            </select>
          </label>
          <span className={styles.resultCount}>{requests.length} pengajuan</span>
        </div>
        {requests.length === 0 ? (
          <EmptyState title="Belum ada pengajuan penukaran" detail="Permintaan peserta akan tampil di sini." />
        ) : (
          <div className={styles.depositList}>
            {requests.map((request) => (
              <article className={styles.depositRow} key={request.id}>
                <div>
                  <strong>{request.rewardName} · {studentMap.get(request.studentId)?.name ?? "Peserta tidak ditemukan"}</strong>
                  <small>{points(request.pointsCost)} · Diajukan {dateTime(request.createdAt)}</small>
                  {request.kind === "money" && <small>Serahkan tunai manual: Rp{(request.moneyAmount ?? 0).toLocaleString("id-ID")}</small>}
                  {request.note && <small>Catatan: {request.note}</small>}
                  {request.status === "pending" && (
                    <label className={styles.field}>Catatan / alasan
                      <input
                        maxLength={300}
                        onChange={(event) => setNotes((current) => ({ ...current, [request.id]: event.target.value }))}
                        value={notes[request.id] ?? ""}
                      />
                    </label>
                  )}
                </div>
                <div className={styles.depositStatus}>
                  <span className={`${styles.status} ${request.status === "fulfilled" ? styles.statusApproved : request.status === "rejected" ? styles.statusRejected : request.status === "pending" ? styles.statusPending : styles.statusProcessing}`}>
                    {rewardStatus(request.status)}
                  </span>
                  {request.status === "pending" && (
                    <div className={styles.tableActions}>
                      <button className={styles.smallButton} disabled={busy} onClick={() => void performBusyAction(() => onReview(request.id, "approve", notes[request.id] ?? ""))} type="button">Setujui</button>
                      <button className={styles.textButton} disabled={busy} onClick={() => void performBusyAction(() => onReview(request.id, "reject", notes[request.id] ?? ""))} type="button">Tolak</button>
                    </div>
                  )}
                  {request.status === "approved" && (
                    <button className={styles.smallButton} disabled={busy} onClick={() => void performBusyAction(() => onFulfill(request.id))} type="button">Tandai diserahkan</button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    );
  }

  const rewards = data.rewards.filter((reward) => reward.active);
  const myRequests = data.redemptionRequests
    .filter((request) => request.studentId === accountId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return (
    <div className={styles.twoColumns}>
      <section className={styles.card}>
        <div className={styles.sectionTitle}>
          <div><h2>Reward tersedia</h2><p>Poin tersedia: <strong>{points(availablePoints)}</strong></p></div>
        </div>
        {rewards.length === 0 ? (
          <EmptyState title="Belum ada reward" detail="Pengelola belum menambahkan reward ke katalog." />
        ) : (
          <div className={styles.depositList}>
            {rewards.map((reward) => {
              const unavailable = reward.stock !== null && reward.stock < 1;
              return (
                <article className={styles.depositRow} key={reward.id}>
                  <div>
                    <strong>{reward.name}</strong>
                    <small>{reward.kind === "money" ? `Uang tunai Rp${(reward.moneyAmount ?? 0).toLocaleString("id-ID")}` : reward.description || "Reward barang"}</small>
                    <small>{points(reward.pointsCost)}{reward.kind === "item" && reward.stock !== null ? ` · Stok ${reward.stock}` : ""}</small>
                  </div>
                  <button
                    className={styles.smallButton}
                    disabled={busy || unavailable || availablePoints < reward.pointsCost}
                    onClick={() => void performBusyAction(() => onRequest(reward.id))}
                    type="button"
                  >
                    {unavailable ? "Stok habis" : "Ajukan tukar"}
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </section>
      <section className={styles.card}>
        <SectionTitle title="Riwayat penukaran" />
        {myRequests.length === 0 ? (
          <EmptyState title="Belum ada penukaran" detail="Pengajuan reward dan statusnya akan tercatat di sini." />
        ) : (
          <div className={styles.depositList}>
            {myRequests.map((request) => (
              <article className={styles.depositRow} key={request.id}>
                <div>
                  <strong>{request.rewardName}</strong>
                  <small>{points(request.pointsCost)} · {dateTime(request.createdAt)}</small>
                  {request.note && <small>Catatan pengelola: {request.note}</small>}
                </div>
                <span className={`${styles.status} ${request.status === "fulfilled" ? styles.statusApproved : request.status === "rejected" ? styles.statusRejected : request.status === "pending" ? styles.statusPending : styles.statusProcessing}`}>
                  {rewardStatus(request.status)}
                </span>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
