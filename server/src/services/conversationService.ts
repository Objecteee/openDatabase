/**
 * conversations 表操作
 */

import { supabase } from "../lib/supabase.js";

export async function createConversation(userId: string) {
  if (!supabase) throw new Error("Supabase 未配置");
  const { data, error } = await supabase
    .from("conversations")
    .insert({ user_id: userId })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export async function getConversationById(
  id: string,
): Promise<{ id: string; user_id: string | null; title: string | null; created_at: string; updated_at: string } | null> {
  if (!supabase) throw new Error("Supabase 未配置");
  const { data, error } = await supabase
    .from("conversations")
    .select("id, user_id, title, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getConversations(userId?: string, limit = 20) {
  if (!supabase) throw new Error("Supabase 未配置");
  let query = supabase
    .from("conversations")
    .select("id, title, created_at, updated_at")
    .order("updated_at", { ascending: false })
    .limit(limit);
  if (userId) query = query.eq("user_id", userId);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function updateConversationTitle(id: string, title: string) {
  if (!supabase) throw new Error("Supabase 未配置");
  const { error } = await supabase
    .from("conversations")
    .update({ title, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

/** 仅刷新会话的 updated_at，用于新消息写入后排序 */
export async function updateConversationUpdatedAt(id: string) {
  if (!supabase) throw new Error("Supabase 未配置");
  const { error } = await supabase
    .from("conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteConversation(id: string) {
  if (!supabase) throw new Error("Supabase 未配置");
  const { error } = await supabase.from("conversations").delete().eq("id", id);
  if (error) throw error;
}
