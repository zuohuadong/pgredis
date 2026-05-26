import type { PgSqlLike } from "../sql";

export interface BunSqlAdapterInput {
  unsafe<T = Record<string, unknown>>(query: string, params?: readonly unknown[]): Promise<T[]>;
  begin?<T>(callback: (tx: PgSqlLike) => Promise<T>): Promise<T>;
}

export interface BunSqlAdapter extends PgSqlLike {
  readonly raw: BunSqlAdapterInput;
}

export function createBunSqlAdapter(sql: BunSqlAdapterInput): BunSqlAdapter {
  return {
    raw: sql,
    unsafe<T = Record<string, unknown>>(query: string, params?: readonly unknown[]): Promise<T[]> {
      return sql.unsafe<T>(query, params);
    },
    begin: sql.begin
      ? <T>(callback: (tx: PgSqlLike) => Promise<T>) => sql.begin!((tx) => callback(createBunSqlAdapter(tx)))
      : undefined
  };
}

export const createBunPostgresAdapter = createBunSqlAdapter;
