// 未保存編集のブラウザ待避（SPEC-vertical-editor-phase2 §7）。
// 素のIndexedDBを薄く包むだけ（依存追加なし）。待避はキャッシュであり正は常にGitHub。
// クライアント専用（サーバーでは呼ばない）

const DB_NAME = "nekonote-editor";
const STORE_NAME = "drafts";

export type Draft = {
  content: string;
  /** 編集開始時点の blob SHA（復元時のリモートずれ検知に使う） */
  baseSha: string;
  updatedAt: number;
};

/** 待避キー（SPEC §7。ブランチはPhase 2ではデフォルトのみだがキーに含めて将来に備える） */
export function draftKey(repo: string, branch: string, path: string): string {
  return `${repo}:${branch}:${path}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = operation(
        db.transaction(STORE_NAME, mode).objectStore(STORE_NAME),
      );
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function getDraft(key: string): Promise<Draft | null> {
  const value = await withStore("readonly", (store) => store.get(key));
  return (value as Draft | undefined) ?? null;
}

export async function setDraft(key: string, draft: Draft): Promise<void> {
  await withStore("readwrite", (store) => store.put(draft, key));
}

export async function deleteDraft(key: string): Promise<void> {
  await withStore("readwrite", (store) => store.delete(key));
}

/** 指定プレフィックス（`{repo}:{branch}:`）の待避キー一覧。サイドバーの未保存印に使う */
export async function listDraftKeys(prefix: string): Promise<string[]> {
  const keys = await withStore("readonly", (store) => store.getAllKeys());
  return keys.filter(
    (key): key is string => typeof key === "string" && key.startsWith(prefix),
  );
}
