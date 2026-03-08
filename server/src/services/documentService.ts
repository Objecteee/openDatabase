/**
 * documents 表操作
 */

import { supabase } from "../lib/supabase.js";

export interface DocumentInsert {
  user_id?: string;
  name: string;
  type: string;
  size: number;
  hash: string;
  storage_path: string;
  summary?: string;
  status?: string;
}

export async function createDocument(doc: DocumentInsert) {
  if (!supabase) throw new Error("Supabase 未配置");
  const { data, error } = await supabase
    .from("documents")
    .insert({
      ...doc,
      status: doc.status ?? "pending",
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export async function getDocumentById(id: string) {
  if (!supabase) throw new Error("Supabase 未配置");
  const { data, error } = await supabase.from("documents").select("*").eq("id", id).single();
  if (error) throw error;
  return data;
}

export async function findByHash(hash: string) {
  if (!supabase) throw new Error("Supabase 未配置");
  const { data, error } = await supabase
    .from("documents")
    .select("id, storage_path")
    .eq("hash", hash)
    .eq("status", "completed")
    .limit(1)
    .single();
  if (error && error.code !== "PGRST116") throw error;
  return data;
}

export async function updateDocumentStatus(
  id: string,
  status: "pending" | "processing" | "completed" | "failed",
  opts?: { error_message?: string; summary?: string }
) {
  if (!supabase) throw new Error("Supabase 未配置");
  const { error } = await supabase
    .from("documents")
    .update({
      status,
      error_message: opts?.error_message,
      summary: opts?.summary,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw error;
}
