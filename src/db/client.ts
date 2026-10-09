/**
 * Supabase client factories.
 *
 * - getServiceClient(): server-only, uses the service-role key. Full access, bypasses RLS.
 *   Use inside BrainService / repositories. NEVER import this into client components.
 * - getAnonClient(): browser-safe anon client (for future auth-scoped reads from the client).
 *
 * All SQL/data access in the app flows through repositories that use getServiceClient().
 * (See .kiro/steering/structure.md — ALL SQL lives in src/db.)
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { getServerConfig, publicConfig } from "@/config/env";

let serviceClient: SupabaseClient<Database> | null = null;

/** Server-only. Lazily constructed, memoized. */
export function getServiceClient(): SupabaseClient<Database> {
  if (serviceClient) return serviceClient;
  const cfg = getServerConfig();
  serviceClient = createClient<Database>(cfg.supabase.url, cfg.supabase.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return serviceClient;
}

/** Browser-safe anon client. */
export function getAnonClient(): SupabaseClient<Database> {
  return createClient<Database>(publicConfig.supabaseUrl, publicConfig.supabaseAnonKey, {
    auth: { persistSession: true },
  });
}
