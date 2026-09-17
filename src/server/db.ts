// ZAYTRIX Database Layer — Supabase-backed Prisma-like adapter.
// Converts Prisma camelCase field names ↔ PostgreSQL snake_case column names.
// Uses @supabase/supabase-js REST API (works on Termux/Proot).
// All 13 files import { prisma } from "./db" — no changes needed.
//
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { COLUMN_MAP } from "./columnMap";

// ─── Configuration ───────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL || "https://mtvaoftwuojntmrqhyyb.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";

// ─── Client ────────────────────────────────────
export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
  db: { schema: "public" },
});

// ─── camelCase ↔ snake_case ─────────────────
function camelToSnake(str: string): string {
  return str.replace(/([A-Z])/g, "_$1").toLowerCase().replace(/^_/, "").replace(/_/g, "");
}

function camelKeysToSnake(obj: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (val === null || val === undefined) continue;
    result[camelToSnake(key)] = val;
  }
  return result;
}

function snakeToCamel(str: string): string {
  if (COLUMN_MAP[str]) return COLUMN_MAP[str];
  return str.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function toCamelResults(data: any[]): any[] {
  return data.map(item => {
    if (Array.isArray(item)) return toCamelResults(item);
    if (item && typeof item === "object") {
      const result: Record<string, any> = {};
      for (const [key, val] of Object.entries(item)) {
        result[snakeToCamel(key)] = (val && typeof val === "object") ? toCamelResults([val])[0] : val;
      }
      return result;
    }
    return item;
  });
}

function toCamelSingle(data: any): any {
  if (Array.isArray(data)) return toCamelResults(data);
  if (data && typeof data === "object") {
    const result: Record<string, any> = {};
    for (const [key, val] of Object.entries(data)) {
      result[snakeToCamel(key)] = (val && typeof val === "object" && !Array.isArray(val)) ? toCamelSingle(val) : val;
    }
    return result;
  }
  return data;
}

// ─── Where clause translator ──────────────────
function applyFilter(query: any, field: string, condition: any): any {
  if (condition === null || condition === undefined) return query;

  if (field === "AND" && Array.isArray(condition)) {
    for (const sub of condition as any[]) {
      for (const [subField, subCond] of Object.entries(sub as Record<string, any>)) {
        if (subField === "OR") {
          const orParts: string[] = [];
          for (const orCond of subCond as any[]) {
            for (const [orField, orVal] of Object.entries(orCond as Record<string, any>)) {
              orParts.push(`eq.${camelToSnake(orField)},${JSON.stringify(orVal)}`);
            }
          }
          if (orParts.length > 0) {
            query = query.or(orParts.join(","));
          }
        } else {
          query = applyFilter(query, subField, subCond);
        }
      }
    }
    return query;
  }

  if (field === "OR") return query;

  if (typeof condition === "object" && !Array.isArray(condition)) {
    const operators = ["gt", "gte", "lt", "lte", "in", "notIn", "contains", "startsWith", "endsWith", "not", "equals"];
    for (const op of operators) {
      if (op in condition) {
        const val = condition[op];
        switch (op) {
          case "gt": return query.gt(camelToSnake(field), val);
          case "gte": return query.gte(camelToSnake(field), val);
          case "lt": return query.lt(camelToSnake(field), val);
          case "lte": return query.lte(camelToSnake(field), val);
          case "not": return query.neq(camelToSnake(field), val);
          case "equals": return query.eq(camelToSnake(field), val);
          case "in": return query.in(camelToSnake(field), val);
          case "notIn": return query.notIn(camelToSnake(field), val);
          case "contains": return query.contains(camelToSnake(field), val);
          case "startsWith": return query.filter(camelToSnake(field), "like", `${val}%`);
          case "endsWith": return query.filter(camelToSnake(field), "like", `%${val}`);
        }
      }
    }
    for (const [subField, subCond] of Object.entries(condition as Record<string, any>)) {
      query = applyFilter(query, subField, subCond);
    }
    return query;
  }

  return query.eq(camelToSnake(field), condition);
}

function buildWhere(query: any, where: any): any {
  if (!where || Object.keys(where).length === 0) return query;
  return applyFilter(query, "", where);
}

// ─── Select fields ────────────────────────────
function buildSelect(select?: Record<string, boolean | string>): string {
  if (!select) return "*";
  const fields: string[] = [];
  for (const [key, val] of Object.entries(select)) {
    const snakeKey = camelToSnake(key);
    if (val === true) fields.push(snakeKey);
    else if (typeof val === "string") fields.push(`${snakeKey}:${val}`);
  }
  return fields.length > 0 ? fields.join(",") : "*";
}

// ─── Types ────────────────────────────────
interface FindOptions {
  where?: Record<string, any>;
  select?: Record<string, boolean | string>;
  take?: number;
  skip?: number;
  orderBy?: Array<Record<string, "asc" | "desc">> | Record<string, "asc" | "desc">;
}

interface CreateOptions {
  data: Record<string, any>;
  select?: Record<string, boolean | string>;
}

interface UpdateOptions {
  where: Record<string, any>;
  data: Record<string, any>;
  select?: Record<string, boolean | string>;
}

interface UpsertOptions {
  where: Record<string, any>;
  create: Record<string, any>;
  update: Record<string, any>;
  select?: Record<string, boolean | string>;
}

interface CountOptions {
  where?: Record<string, any>;
}

interface ModelDb {
  findMany(opts?: FindOptions): Promise<any[]>;
  findUnique(opts: { where: Record<string, any>; select?: Record<string, boolean | string> }): Promise<any | null>;
  findFirst(opts: FindOptions): Promise<any | null>;
  create(opts: CreateOptions): Promise<any>;
  upsert(opts: UpsertOptions): Promise<any>;
  update(opts: UpdateOptions): Promise<any>;
  updateMany(opts: { where: Record<string, any>; data: Record<string, any> }): Promise<{ count: number }>;
  delete(opts: { where: Record<string, any> }): Promise<any>;
  deleteMany(opts: { where: Record<string, any> }): Promise<{ count: number }>;
  count(opts?: CountOptions): Promise<number>;
}

function applyOrderBy(query: any, orderBy: FindOptions["orderBy"]): any {
  if (!orderBy) return query;
  if (Array.isArray(orderBy)) {
    for (const entry of orderBy) {
      for (const [field, dir] of Object.entries(entry)) {
        query = query.order(camelToSnake(field), { ascending: dir === "asc" });
      }
    }
  } else {
    for (const [field, dir] of Object.entries(orderBy)) {
      query = query.order(camelToSnake(field), { ascending: dir === "asc" });
    }
  }
  return query;
}

function createModel(modelName: string): ModelDb {
  const client = supabase;

  return {
    async findMany(opts: FindOptions = {}): Promise<any[]> {
      let query = client.from(modelName).select(buildSelect(opts.select));
      query = buildWhere(query, opts.where);
      query = applyOrderBy(query, opts.orderBy);
      if (opts.skip) {
        const take = opts.take || 10;
        query = query.range(opts.skip, opts.skip + take - 1);
      } else if (opts.take) {
        query = query.limit(opts.take);
      }
      const { data, error } = await query;
      if (error) throw error;
      return toCamelResults(data || []);
    },

    async findUnique(opts: { where: Record<string, any>; select?: Record<string, boolean | string> }): Promise<any | null> {
      let query = client.from(modelName).select(buildSelect(opts.select));
      for (const [key, val] of Object.entries(opts.where)) {
        query = query.eq(camelToSnake(key), val);
      }
      const { data, error } = await query.single();
      if (error && error.code !== "PGRST116") throw error;
      return data ? toCamelSingle(data) : null;
    },

    async findFirst(opts: FindOptions = {}): Promise<any | null> {
      let query = client.from(modelName).select(buildSelect(opts.select));
      query = buildWhere(query, opts.where);
      query = applyOrderBy(query, opts.orderBy);
      query = query.limit(1);
      const { data, error } = await query.single();
      if (error && error.code !== "PGRST116") throw error;
      return data ? toCamelSingle(data) : null;
    },

    async create(opts: CreateOptions): Promise<any> {
      let data = camelKeysToSnake(opts.data);
      const now = new Date().toISOString();
      const createdAtKey = camelToSnake("createdAt");
      const updatedAtKey = camelToSnake("updatedAt");
      if (!data[createdAtKey]) data[createdAtKey] = now;
      if (!data[updatedAtKey]) data[updatedAtKey] = now;
      const { data: result, error } = await client
        .from(modelName)
        .insert(data)
        .select(buildSelect(opts.select))
        .single();
      if (error) {
        const tsKeys = {} as Record<string, any>;
        tsKeys[createdAtKey] = data[createdAtKey];
        tsKeys[updatedAtKey] = data[updatedAtKey];
        if (Object.values(tsKeys).some(v => v) && !error.message?.includes("successfully")) {
          const filtered = { ...data };
          delete filtered[createdAtKey];
          delete filtered[updatedAtKey];
          const r2 = await client.from(modelName).insert(filtered).select(buildSelect(opts.select)).single();
          if (r2.error) throw r2.error;
          return r2.data ? toCamelSingle(r2.data) : null;
        }
        throw error;
      }
      return result ? toCamelSingle(result) : null;
    },

    async upsert(opts: UpsertOptions): Promise<any> {
      const upsertSnake = camelKeysToSnake({ ...opts.create, ...opts.where, ...opts.update });
      const { data, error } = await client.from(modelName).upsert(upsertSnake).select(buildSelect(opts.select)).single();
      if (error) throw error;
      return data ? toCamelSingle(data) : null;
    },

    async update(opts: UpdateOptions): Promise<any> {
      let data = camelKeysToSnake(opts.data);
      const updatedAtKey = camelToSnake("updatedAt");
      if (data[camelToSnake("createdAt")] !== undefined) delete data[camelToSnake("createdAt")];
      data[updatedAtKey] = new Date().toISOString();
      let query = client.from(modelName).update(data).select(buildSelect(opts.select));
      query = buildWhere(query, opts.where);
      const { data: result, error } = await query.single();
      if (error) {
        if ((error.code === "42703" || error.code === "PGRST204") && data[updatedAtKey]) {
          delete data[updatedAtKey];
          let q2 = client.from(modelName).update(data).select(buildSelect(opts.select));
          q2 = buildWhere(q2, opts.where);
          const { data: d2, error: e2 } = await q2.single();
          if (e2) throw e2;
          return d2 ? toCamelSingle(d2) : null;
        }
        throw error;
      }
      return result ? toCamelSingle(result) : null;
    },

    async updateMany(opts: { where: Record<string, any>; data: Record<string, any> }): Promise<{ count: number }> {
      let query = client.from(modelName).update(camelKeysToSnake(opts.data));
      query = buildWhere(query, opts.where);
      const { count, error } = await query;
      if (error) throw error;
      return { count: count || 0 };
    },

    async delete(opts: { where: Record<string, any> }): Promise<any> {
      let query = client.from(modelName).delete().select("*");
      query = buildWhere(query, opts.where);
      const { data, error } = await query.single();
      if (error) throw error;
      return data ? toCamelSingle(data) : null;
    },

    async deleteMany(opts: { where: Record<string, any> }): Promise<{ count: number }> {
      let query = client.from(modelName).delete();
      query = buildWhere(query, opts.where);
      const { count, error } = await query;
      if (error) throw error;
      return { count: count || 0 };
    },

    async count(opts: CountOptions = {}): Promise<number> {
      let query = client.from(modelName).select("count", { count: "exact" });
      query = buildWhere(query, opts.where);
      const { data, error } = await query.single();
      if (error) throw error;
      return (data as any)?.count || 0;
    },
  };
}

// ─── Export ────────────────────────────────────────
const prisma: {
  user: ModelDb;
  apiKey: ModelDb;
  auditLog: ModelDb;
  emailVerificationToken: ModelDb;
  session: ModelDb;
  portfolioHolding: ModelDb;
  ledgerTransaction: ModelDb;
  backtestResult: ModelDb;
  conversionTransaction: ModelDb;
  alertConfig: ModelDb;
  webAuthnCredential: ModelDb;
  chatMessage: ModelDb;
  aiUsageEvent: ModelDb;
  paperAccount: ModelDb;
  paperOrder: ModelDb;
  paperPosition: ModelDb;
  $disconnect: () => Promise<void>;
  $queryRawUnsafe: (query: string, ...params: any[]) => Promise<any[]>;
  $transaction: (arg: any) => Promise<any>;
} = {
  user: createModel("users"),
  apiKey: createModel("api_keys"),
  auditLog: createModel("audit_logs"),
  emailVerificationToken: createModel("email_verification_tokens"),
  session: createModel("sessions"),
  portfolioHolding: createModel("portfolio_holdings"),
  ledgerTransaction: createModel("ledger_transactions"),
  backtestResult: createModel("backtest_results"),
  conversionTransaction: createModel("conversion_transactions"),
  alertConfig: createModel("alert_configs"),
  webAuthnCredential: createModel("webauthn_credentials"),
  chatMessage: createModel("chat_messages"),
  aiUsageEvent: createModel("ai_usage_events"),
  paperAccount: createModel("paper_accounts"),
  paperOrder: createModel("paper_orders"),
  paperPosition: createModel("paper_positions"),
  $disconnect: async (): Promise<void> => {
    // No-op: Supabase client manages connection pool internally
  },
  $queryRawUnsafe: async (query: string, ...params: any[]): Promise<any[]> => {
    // Raw SQL via Supabase RPC (requires exec_sql function in DB).
    // If function doesn't exist yet, return empty array.
    // To enable: create function in Supabase SQL Editor:
    //   CREATE OR REPLACE FUNCTION exec_sql(q text) RETURNS json AS $$
    //   BEGIN RETURN (SELECT json_agg(r) FROM ($q) r); END; $$ LANGUAGE plpgsql;
    try {
      const { data, error } = await supabase.rpc("exec_sql", { q: query });
      if (error) {
        console.warn("[db] exec_sql RPC unavailable:", error.message);
        return [];
      }
      return toCamelResults(data || []);
    } catch (e: any) {
      console.warn("[db] exec_sql failed:", e.message);
      return [];
    }
  },
  $transaction: async (arg: any): Promise<any> => {
    if (typeof arg === "function") {
      const txModels: Record<string, any> = {};
      const modelNames = [
        "users", "api_keys", "audit_logs", "email_verification_tokens",
        "sessions", "portfolio_holdings", "ledger_transactions", "backtest_results",
        "conversion_transactions", "alert_configs", "webauthn_credentials",
        "chat_messages", "ai_usage_events", "paper_accounts", "paper_orders", "paper_positions"
      ];
      for (const mn of modelNames) {
        txModels[mn] = createModel(mn);
      }
      const txObj: any = {
        ...txModels,
        $queryRawUnsafe: (q: string, ...p: any[]) => prisma.$queryRawUnsafe(q, ...p),
      };
      return await arg(txObj);
    }
    if (Array.isArray(arg)) {
      const results = [];
      for (const op of arg) {
        results.push(await Promise.resolve(op));
      }
      return results;
    }
    return undefined;
  },
};

export { prisma };
export default prisma;
