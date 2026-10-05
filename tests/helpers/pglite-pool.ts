import type { PGlite } from '@electric-sql/pglite';

export function pglitePool(db: PGlite) {
  return {
    query: (text: string, values?: unknown[]) => db.query(text, values),
    connect: async () => {
      let transaction: any;
      let work: Promise<unknown> | undefined;
      let commit: (() => void) | undefined;
      let rollback: ((error: Error) => void) | undefined;
      return {
        query: async (text: string, values?: unknown[]) => {
          const statement = text.trim().toLowerCase();
          if (statement === 'begin') {
            let ready!: () => void;
            const started = new Promise<void>(resolve => { ready = resolve; });
            const held = new Promise<void>((resolve, reject) => { commit = resolve; rollback = reject; });
            work = db.transaction(async tx => { transaction = tx; ready(); await held; });
            await started;
            return { rows: [], rowCount: 0 };
          }
          if (statement === 'commit') {
            commit?.();
            await work;
            transaction = undefined;
            return { rows: [], rowCount: 0 };
          }
          if (statement === 'rollback') {
            rollback?.(new Error('test transaction rollback'));
            await work?.catch(() => {});
            transaction = undefined;
            return { rows: [], rowCount: 0 };
          }
          return transaction ? transaction.query(text, values) : db.query(text, values);
        },
        release() {},
      };
    },
  };
}
