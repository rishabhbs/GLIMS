/**
 * Database types for the Supabase client.
 *
 * Hand-authored to match supabase/migrations/0001_init.sql for M1. Once a live
 * Supabase project exists, regenerate with:
 *   supabase gen types typescript --local > src/db/database.types.ts
 * Keep this file and the migrations in sync until then.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

/** Narrow an arbitrary value into the Json type for DB columns. Use when the
 * value is known-serializable (snapshots, change payloads, attributes). */
export function asJson(value: unknown): Json {
  return value as Json;
}

type Timestamps = { created_at: string };

export interface Database {
  public: {
    Tables: {
      workspaces: {
        Row: { id: string; name: string } & Timestamps;
        Insert: { id?: string; name: string; created_at?: string };
        Update: Partial<Database["public"]["Tables"]["workspaces"]["Insert"]>;
        Relationships: [];
      };
      products: {
        Row: {
          id: string; workspace_id: string; slug: string; name: string;
          one_liner: string; positioning: string; active: boolean; sort_order: number; created_at: string;
        };
        Insert: {
          id?: string; workspace_id: string; slug: string; name: string;
          one_liner?: string; positioning?: string; active?: boolean; sort_order?: number; created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["products"]["Insert"]>;
        Relationships: [];
      };
      entity_types: {
        Row: { key: string; label: string; description: string | null; sort_order: number; is_system: boolean };
        Insert: { key: string; label: string; description?: string | null; sort_order?: number; is_system?: boolean };
        Update: Partial<Database["public"]["Tables"]["entity_types"]["Insert"]>;
        Relationships: [];
      };
      relationship_types: {
        Row: { key: string; label: string; description: string | null; is_directional: boolean };
        Insert: { key: string; label: string; description?: string | null; is_directional?: boolean };
        Update: Partial<Database["public"]["Tables"]["relationship_types"]["Insert"]>;
        Relationships: [];
      };
      sources: {
        Row: {
          id: string; workspace_id: string; product_id: string | null; type: string; title: string | null;
          uri: string | null; storage_path: string | null; raw_text: string | null;
          content_hash: string; sensitivity: string; extraction_method: string | null;
          added_by: string | null;
        } & Timestamps;
        Insert: {
          id?: string; workspace_id: string; product_id?: string | null; type: string; title?: string | null;
          uri?: string | null; storage_path?: string | null; raw_text?: string | null;
          content_hash: string; sensitivity?: string; extraction_method?: string | null;
          added_by?: string | null; created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["sources"]["Insert"]>;
        Relationships: [];
      };
      ingestion_jobs: {
        Row: {
          id: string; workspace_id: string; source_id: string; status: string;
          attempts: number; error: string | null; idempotency_key: string | null;
          created_at: string; updated_at: string;
        };
        Insert: {
          id?: string; workspace_id: string; source_id: string; status?: string;
          attempts?: number; error?: string | null; idempotency_key?: string | null;
          created_at?: string; updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["ingestion_jobs"]["Insert"]>;
        Relationships: [];
      };
      source_chunks: {
        Row: {
          id: string; workspace_id: string; source_id: string; ordinal: number;
          content: string; locator: Json | null; embedding: string | null;
          embedding_model: string | null;
        } & Timestamps;
        Insert: {
          id?: string; workspace_id: string; source_id: string; ordinal: number;
          content: string; locator?: Json | null; embedding?: string | null;
          embedding_model?: string | null; created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["source_chunks"]["Insert"]>;
        Relationships: [];
      };
      knowledge_items: {
        Row: {
          id: string; workspace_id: string; product_id: string | null; entity_type: string; title: string;
          claim: string; body: string | null; status: string; source_classification: string;
          confidence: number; attributes: Json; embedding: string | null;
          embedding_model: string | null; superseded_by: string | null; created_by: string | null;
          confirmed_by: string | null; confirmed_at: string | null; created_at: string; updated_at: string;
        };
        Insert: {
          id?: string; workspace_id: string; product_id?: string | null; entity_type: string; title: string;
          claim: string; body?: string | null; status?: string; source_classification?: string;
          confidence?: number; attributes?: Json; embedding?: string | null;
          embedding_model?: string | null; superseded_by?: string | null; created_by?: string | null;
          confirmed_by?: string | null; confirmed_at?: string | null; created_at?: string; updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["knowledge_items"]["Insert"]>;
        Relationships: [];
      };
      evidence: {
        Row: {
          id: string; workspace_id: string; item_id: string; source_id: string;
          chunk_id: string | null; snippet: string | null; locator: Json | null;
        } & Timestamps;
        Insert: {
          id?: string; workspace_id: string; item_id: string; source_id: string;
          chunk_id?: string | null; snippet?: string | null; locator?: Json | null; created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["evidence"]["Insert"]>;
        Relationships: [];
      };
      knowledge_relationships: {
        Row: {
          id: string; workspace_id: string; from_item_id: string; to_item_id: string;
          relationship_type: string; note: string | null; created_by: string | null;
        } & Timestamps;
        Insert: {
          id?: string; workspace_id: string; from_item_id: string; to_item_id: string;
          relationship_type: string; note?: string | null; created_by?: string | null; created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["knowledge_relationships"]["Insert"]>;
        Relationships: [];
      };
      knowledge_item_revisions: {
        Row: {
          id: string; item_id: string; snapshot: Json; changed_by: string | null;
          change_reason: string | null;
        } & Timestamps;
        Insert: {
          id?: string; item_id: string; snapshot: Json; changed_by?: string | null;
          change_reason?: string | null; created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["knowledge_item_revisions"]["Insert"]>;
        Relationships: [];
      };
      audit_log: {
        Row: {
          id: string; workspace_id: string; actor: string | null; action: string;
          target_type: string; target_id: string | null; detail: Json | null;
        } & Timestamps;
        Insert: {
          id?: string; workspace_id: string; actor?: string | null; action: string;
          target_type: string; target_id?: string | null; detail?: Json | null; created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["audit_log"]["Insert"]>;
        Relationships: [];
      };
      conversations: {
        Row: {
          id: string; workspace_id: string; title: string | null; created_by: string | null;
          created_at: string; updated_at: string;
        };
        Insert: {
          id?: string; workspace_id: string; title?: string | null; created_by?: string | null;
          created_at?: string; updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["conversations"]["Insert"]>;
        Relationships: [];
      };
      messages: {
        Row: {
          id: string; workspace_id: string; conversation_id: string; ordinal: number;
          role: string; content: string; grounding_status: string | null; citations: Json | null;
          sources_used: Json | null; created_by: string | null;
        } & Timestamps;
        Insert: {
          id?: string; workspace_id: string; conversation_id: string; ordinal: number;
          role: string; content: string; grounding_status?: string | null; citations?: Json | null;
          sources_used?: Json | null; created_by?: string | null; created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["messages"]["Insert"]>;
        Relationships: [];
      };
      research_sessions: {
        Row: {
          id: string; workspace_id: string; conversation_id: string | null; message_id: string | null;
          question: string; trigger: string; provider: string;
        } & Timestamps;
        Insert: {
          id?: string; workspace_id: string; conversation_id?: string | null; message_id?: string | null;
          question: string; trigger: string; provider: string; created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["research_sessions"]["Insert"]>;
        Relationships: [];
      };
      research_queries: {
        Row: {
          id: string; session_id: string; query: string; include_domains: string[] | null;
        } & Timestamps;
        Insert: {
          id?: string; session_id: string; query: string; include_domains?: string[] | null; created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["research_queries"]["Insert"]>;
        Relationships: [];
      };
      research_findings: {
        Row: {
          id: string; workspace_id: string; session_id: string; query_id: string | null;
          url: string; title: string | null; excerpt: string | null; raw_text: string | null;
          published_date: string | null; retrieved_at: string; is_primary_source: boolean;
          accessible: boolean; error: string | null; promoted_source_id: string | null;
        } & Timestamps;
        Insert: {
          id?: string; workspace_id: string; session_id: string; query_id?: string | null;
          url: string; title?: string | null; excerpt?: string | null; raw_text?: string | null;
          published_date?: string | null; retrieved_at?: string; is_primary_source?: boolean;
          accessible?: boolean; error?: string | null; promoted_source_id?: string | null; created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["research_findings"]["Insert"]>;
        Relationships: [];
      };
      message_research: {
        Row: {
          id: string; workspace_id: string; message_id: string; finding_id: string; rank: number | null;
        } & Timestamps;
        Insert: {
          id?: string; workspace_id: string; message_id: string; finding_id: string; rank?: number | null; created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["message_research"]["Insert"]>;
        Relationships: [];
      };
      message_grounding: {
        Row: {
          id: string; workspace_id: string; message_id: string; item_id: string | null;
          source_id: string | null; rank: number | null;
        } & Timestamps;
        Insert: {
          id?: string; workspace_id: string; message_id: string; item_id?: string | null;
          source_id?: string | null; rank?: number | null; created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["message_grounding"]["Insert"]>;
        Relationships: [];
      };
      corrections: {
        Row: {
          id: string; workspace_id: string; conversation_id: string; message_id: string | null;
          correction_text: string; correction_source_id: string | null; status: string;
          created_by: string | null;
        } & Timestamps;
        Insert: {
          id?: string; workspace_id: string; conversation_id: string; message_id?: string | null;
          correction_text: string; correction_source_id?: string | null; status?: string;
          created_by?: string | null; created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["corrections"]["Insert"]>;
        Relationships: [];
      };
      knowledge_changes: {
        Row: {
          id: string; workspace_id: string; correction_id: string | null; message_id: string | null;
          item_id: string; revision_id: string | null; change_type: string; before: Json | null;
          after: Json | null; created_by: string | null;
        } & Timestamps;
        Insert: {
          id?: string; workspace_id: string; correction_id?: string | null; message_id?: string | null;
          item_id: string; revision_id?: string | null; change_type: string; before?: Json | null;
          after?: Json | null; created_by?: string | null; created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["knowledge_changes"]["Insert"]>;
        Relationships: [];
      };
      studio_state: {
        Row: { workspace_id: string; key: string; value: Json; updated_at: string };
        Insert: { workspace_id: string; key: string; value: Json; updated_at?: string };
        Update: Partial<Database["public"]["Tables"]["studio_state"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      match_knowledge_items: {
        Args: {
          p_workspace_id: string; p_query_embedding: string; p_match_count?: number;
          p_exclude_statuses?: string[];
        };
        Returns: {
          id: string; entity_type: string; title: string; claim: string; status: string;
          source_classification: string; confidence: number; similarity: number;
        }[];
      };
      keyword_knowledge_items: {
        Args: {
          p_workspace_id: string; p_query: string; p_match_count?: number;
          p_exclude_statuses?: string[];
        };
        Returns: {
          id: string; entity_type: string; title: string; claim: string; status: string;
          source_classification: string; confidence: number; similarity: number;
        }[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
