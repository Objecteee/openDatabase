/**
 * conversations 表操作
 */
import { supabase } from "../lib/supabase.js";
export async function createConversation(userId) {
    if (!supabase)
        throw new Error("Supabase 未配置");
    const { data, error } = await supabase
        .from("conversations")
        .insert({ user_id: userId ?? null })
        .select("id")
        .single();
    if (error)
        throw error;
    return data.id;
}
export async function getConversations(userId, limit = 20) {
    if (!supabase)
        throw new Error("Supabase 未配置");
    let query = supabase
        .from("conversations")
        .select("id, title, created_at, updated_at")
        .order("updated_at", { ascending: false })
        .limit(limit);
    if (userId)
        query = query.eq("user_id", userId);
    const { data, error } = await query;
    if (error)
        throw error;
    return data ?? [];
}
export async function updateConversationTitle(id, title) {
    if (!supabase)
        throw new Error("Supabase 未配置");
    const { error } = await supabase
        .from("conversations")
        .update({ title, updated_at: new Date().toISOString() })
        .eq("id", id);
    if (error)
        throw error;
}
export async function deleteConversation(id) {
    if (!supabase)
        throw new Error("Supabase 未配置");
    const { error } = await supabase.from("conversations").delete().eq("id", id);
    if (error)
        throw error;
}
