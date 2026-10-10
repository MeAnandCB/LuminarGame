import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export type Param = string | number | bigint | null | undefined;

const clean = (params: Param[]): SQLInputValue[] => params.map((p) => (p === undefined ? null : p));

/** Thin synchronous wrapper around node:sqlite with nested-transaction support. */
export class Db {
  readonly raw: DatabaseSync;
  private depth = 0;

  constructor(file: string) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    this.raw = new DatabaseSync(file);
    this.raw.exec('PRAGMA foreign_keys = ON');
    this.raw.exec('PRAGMA busy_timeout = 5000');
    if (file !== ':memory:') {
      this.raw.exec('PRAGMA journal_mode = WAL');
      this.raw.exec('PRAGMA synchronous = FULL');
    }
  }

  get<T = Record<string, any>>(sql: string, ...params: Param[]): T | undefined {
    return this.raw.prepare(sql).get(...clean(params)) as T | undefined;
  }

  all<T = Record<string, any>>(sql: string, ...params: Param[]): T[] {
    return this.raw.prepare(sql).all(...clean(params)) as T[];
  }

  run(sql: string, ...params: Param[]): { changes: number; lastId: number } {
    const r = this.raw.prepare(sql).run(...clean(params));
    return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) };
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  /** Runs fn atomically. Nested calls become savepoints; any throw rolls the whole unit back. */
  tx<T>(fn: () => T): T {
    if (this.depth === 0) {
      this.raw.exec('BEGIN IMMEDIATE');
      this.depth++;
      try {
        const out = fn();
        this.raw.exec('COMMIT');
        return out;
      } catch (e) {
        this.raw.exec('ROLLBACK');
        throw e;
      } finally {
        this.depth--;
      }
    }
    const name = `sp_${this.depth}`;
    this.raw.exec(`SAVEPOINT ${name}`);
    this.depth++;
    try {
      const out = fn();
      this.raw.exec(`RELEASE ${name}`);
      return out;
    } catch (e) {
      this.raw.exec(`ROLLBACK TO ${name}`);
      this.raw.exec(`RELEASE ${name}`);
      throw e;
    } finally {
      this.depth--;
    }
  }

  close(): void {
    this.raw.close();
  }
}
