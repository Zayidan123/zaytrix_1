// Supabase client singleton for ZAYTRIX backend.
// Replaces PrismaClient for database operations.
// Uses Supabase's Postgres REST API (pgweb) via JS client.
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || "https://mtvaoftwuojntmrqhyyb.supabase.co";
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || "";

export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  db: {
    schema: "public",
  },
});

export type DB = SupabaseClient;
