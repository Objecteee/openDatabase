/**
 * documents 表操作
 */
import { supabase } from "../lib/supabase.js";
export async function createDocument(doc) {
    if (!supabase)
        throw new Error("Supabase 未配置");
    const { data, error } = await supabase
        .from("documents")
        .insert({
        ...doc,
        status: doc.status ?? "pending",
        updated_at: new Date().toISOString(),
    })
        .select("id")
        .single();
    if (error)
        throw error;
    return data.id;
}
export async function getDocumentById(id) {
    if (!supabase)
        throw new Error("Supabase 未配置");
    const { data, error } = await supabase.from("documents").select("*").eq("id", id).single();
    if (error)
        throw error;
    return data;
}
export async function findByHash(hash) {
    if (!supabase)
        throw new Error("Supabase 未配置");
    const { data, error } = await supabase
        .from("documents")
        .select("id, storage_path")
        .eq("hash", hash)
        .eq("status", "completed")
        .limit(1)
        .single();
    if (error && error.code !== "PGRST116")
        throw error;
    return data;
}
export async function updateDocumentStatus(id, status, opts) {
    if (!supabase)
        throw new Error("Supabase 未配置");
    const { error } = await supabase
        .from("documents")
        .update({
        status,
        error_message: opts?.error_message,
        summary: opts?.summary,
        updated_at: new Date().toISOString(),
    })
        .eq("id", id);
    if (error)
        throw error;
}
export async function deleteDocument(id) {
    if (!supabase)
        throw new Error("Supabase 未配置");
    const doc = await getDocumentById(id);
    if (doc?.storage_path) {
        await supabase.storage.from("documents").remove([doc.storage_path]);
    }
    const { error } = await supabase.from("documents").delete().eq("id", id);
    if (error)
        throw error;
}
