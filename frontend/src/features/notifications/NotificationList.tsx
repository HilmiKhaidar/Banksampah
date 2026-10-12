import type { BusinessNotification } from "@/lib/business-data";
import { EmptyState } from "@/components/ui/WorkspacePrimitives";
import layoutStyles from "@/features/workspace/Workspace.module.css";
import styles from "./NotificationList.module.css";

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function NotificationList({
  items,
  onRead,
  onReadAll,
}: {
  items: BusinessNotification[];
  onRead: (notification: BusinessNotification) => void;
  onReadAll: () => void;
}) {
  return (
    <section className={layoutStyles.card}>
      {items.length === 0 ? (
        <EmptyState title="Belum ada notifikasi" detail="Pemberitahuan aktivitas akan ditampilkan di sini." />
      ) : (
        <>
          {items.some((item) => !item.readAt) && (
            <div className={styles.toolbar}>
              <button className={layoutStyles.textButton} onClick={onReadAll} type="button">
                Tandai semua dibaca
              </button>
            </div>
          )}
          <div className={styles.list}>
            {items.map((item) => (
              <article className={`${styles.notification} ${!item.readAt ? styles.unread : ""}`} key={item.id}>
                <span className={styles.icon}>{item.kind === "wallet" ? "Rp" : item.kind === "reward" ? "✳" : "↗"}</span>
                <div>
                  <strong>{item.title}</strong>
                  <p>{item.message}</p>
                  <small>{formatDateTime(item.createdAt)}</small>
                </div>
                {!item.readAt && (
                  <button
                    className={layoutStyles.textButton}
                    onClick={() => onRead(item)}
                    type="button"
                  >
                    Tandai dibaca
                  </button>
                )}
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
