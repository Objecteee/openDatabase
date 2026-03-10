/**
 * messages 表操作
 */
import { supabase } from "../lib/supabase.js";
export async function createMessage(msg) {
    if (!supabase)
        throw new Error("Supabase 未配置");
    const { data, error } = await supabase
        .from("messages")
        .insert(msg)
        .select("id, created_at")
        .single();
    if (error)
        throw error;
    return data;
}
export async function getMessagesByConversation(conversationId) {
    if (!supabase)
        throw new Error("Supabase 未配置");
    const { data, error } = await supabase
        .from("messages")
        .select("id, role, content, citations, created_at")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });
    if (error)
        throw error;
    return data ?? [];
}
