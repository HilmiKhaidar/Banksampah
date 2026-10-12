import type { ReactNode } from "react";
import styles from "./WorkspacePrimitives.module.css";

export function DataTable({
  headers,
  children,
}: {
  headers: string[];
  children: ReactNode;
}) {
  return (
    <div className={styles.tableScroll}>
      <table className={styles.table}>
        <thead>
          <tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className={styles.empty}>
      <span aria-hidden="true">✳</span>
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}

export function SectionTitle({
  title,
  action,
  onAction,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className={styles.sectionTitle}>
      <h2>{title}</h2>
      {action && onAction && (
        <button className={styles.sectionAction} onClick={onAction} type="button">
          {action} →
        </button>
      )}
    </div>
  );
}
