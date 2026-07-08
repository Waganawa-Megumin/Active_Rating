// Minimal D1Database shim over better-sqlite3 for workerd-free integration tests.
// Maps D1's positional ?1..?n binding to better-sqlite3's numbered-object form.

import Database from 'better-sqlite3';

class FakeStmt {
  private args: unknown[] = [];
  constructor(public readonly stmt: Database.Statement) {}
  bind(...args: unknown[]): FakeStmt {
    this.args = args;
    return this;
  }
  params(): Record<string, unknown> | undefined {
    if (this.args.length === 0) return undefined;
    const o: Record<string, unknown> = {};
    this.args.forEach((a, i) => (o[String(i + 1)] = a === undefined ? null : a));
    return o;
  }
  async run() {
    const p = this.params();
    const r = p ? this.stmt.run(p) : this.stmt.run();
    return { success: true, meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) } };
  }
  async all<T = unknown>() {
    const p = this.params();
    return { results: (p ? this.stmt.all(p) : this.stmt.all()) as T[], success: true };
  }
  async first<T = unknown>() {
    const p = this.params();
    const r = (p ? this.stmt.get(p) : this.stmt.get()) as T | undefined;
    return r ?? null;
  }
}

export class FakeD1 {
  constructor(public readonly db: Database.Database) {}
  prepare(sql: string): FakeStmt {
    return new FakeStmt(this.db.prepare(sql));
  }
  async batch(stmts: FakeStmt[]) {
    const tx = this.db.transaction((list: FakeStmt[]) =>
      list.map((s) => (s.params() ? s.stmt.run(s.params()!) : s.stmt.run())),
    );
    const res = tx(stmts);
    return res.map((r) => ({ success: true, meta: { changes: r.changes } }));
  }
  async exec(sql: string) {
    this.db.exec(sql);
    return { count: 0, duration: 0 };
  }
}

/** No-op R2 bucket (evidence proof still lives inline in the D1 row). */
export const fakeR2 = {
  async put() {
    return null;
  },
} as unknown as R2Bucket;
