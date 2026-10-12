"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api";
import styles from "./MonthlyRanking.module.css";

type RankingEntry = {
  studentId: string;
  name: string;
  className: string | null;
  points: number;
};

type MonthlyRankingResponse = {
  month: string;
  ranking: RankingEntry[];
};

function monthName(value: string) {
  const date = new Date(`${value}-01T12:00:00`);
  return new Intl.DateTimeFormat("id-ID", {
    month: "long",
    year: "numeric",
  }).format(date);
}

export default function MonthlyRanking({
  currentStudentId,
}: {
  currentStudentId: string;
}) {
  const [result, setResult] = useState<MonthlyRankingResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void apiRequest<MonthlyRankingResponse>("/api/business/ranking/monthly")
      .then((response) => {
        if (!cancelled) setResult(response);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Ranking gagal dimuat. Silakan coba lagi.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const self = result?.ranking.find((entry) => entry.studentId === currentStudentId);
  const rankByPoints = new Map<number, number>();
  result?.ranking.forEach((entry, index) => {
    if (!rankByPoints.has(entry.points)) rankByPoints.set(entry.points, index + 1);
  });
  const selfRank = self ? rankByPoints.get(self.points) ?? null : null;

  return (
    <section aria-labelledby="monthly-ranking-title" className={styles.card}>
      <header className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>PAPAN PERINGKAT</p>
          <h2 id="monthly-ranking-title">Ranking {result ? monthName(result.month) : "bulanan"}</h2>
          <p>Poin dihitung dari setoran yang disetujui pada bulan ini. Penukaran reward tidak mengurangi skor.</p>
        </div>
        {!loading && selfRank !== null && (
          <div className={styles.position} aria-label={`Peringkat kamu ${selfRank}`}>
            <span>Peringkatmu</span>
            <strong>#{selfRank}</strong>
          </div>
        )}
      </header>

      {loading ? (
        <p className={styles.message} role="status">Memuat ranking…</p>
      ) : error ? (
        <p className={styles.error} role="alert">{error}</p>
      ) : result?.ranking.length ? (
        <ol className={styles.list}>
          {result.ranking.slice(0, 50).map((entry, index) => {
            const rank = rankByPoints.get(entry.points) ?? index + 1;
            const isCurrentStudent = entry.studentId === currentStudentId;
            const podiumClass = rank === 1
              ? styles.goldRank
              : rank === 2
                ? styles.silverRank
                : rank === 3
                  ? styles.bronzeRank
                  : "";
            return (
              <li
                className={`${styles.row} ${isCurrentStudent ? styles.currentStudent : ""}`}
                key={entry.studentId}
              >
                <span
                  aria-label={rank <= 3 ? `Peringkat ${rank}` : undefined}
                  className={`${styles.rank} ${rank <= 3 ? styles.topRank : ""} ${podiumClass}`}
                  role={rank <= 3 ? "img" : undefined}
                >
                  {rank <= 3 ? (
                    <svg aria-hidden="true" className={styles.rankCup} viewBox="0 0 24 24">
                      <path d="M7 3h10v2h4v3a5 5 0 0 1-4.17 4.93A6 6 0 0 1 13 15.91V19h4v2H7v-2h4v-3.09a6 6 0 0 1-3.83-2.98A5 5 0 0 1 3 8V5h4V3Zm10 3v4.76A3 3 0 0 0 19 8V7h-2ZM5 7v1a3 3 0 0 0 2 2.83V7H5Z" />
                    </svg>
                  ) : `#${rank}`}
                </span>
                <span aria-hidden="true" className={styles.avatar}>
                  {entry.name.trim().charAt(0).toLocaleUpperCase("id-ID")}
                </span>
                <span className={styles.student}>
                  <strong>{entry.name}{isCurrentStudent ? " (Kamu)" : ""}</strong>
                  {entry.className && <small>{entry.className}</small>}
                </span>
                <strong className={styles.points}>{entry.points.toLocaleString("id-ID")} poin</strong>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className={styles.message}>Belum ada peserta aktif untuk ditampilkan.</p>
      )}
    </section>
  );
}
