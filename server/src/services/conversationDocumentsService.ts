/**
 * conversation_documents 表操作：会话关联文档
 *
 * 用途：
 * - 会话维度绑定若干文档（document_id）
 * - Chat 未显式传 document_ids 时，自动使用该绑定作为 RAG 检索范围
 */

import { supabase } from "../lib/supabase.js";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUuid(id: string): boolean {
  return UUID_REGEX.test(id);
}

export async function getConversationDocumentIds(conversationId: string, userId: string): Promise<string[]> {
  if (!supabase) throw new Error("Supabase 未配置");
  if (!isValidUuid(conversationId)) throw new Error("conversationId 无效");
  if (!isValidUuid(userId)) throw new Error("userId 无效");

  const { data, error } = await supabase
    .from("conversation_documents")
    .select("document_id")
    .eq("conversation_id", conversationId)
    .eq("user_id", userId);
  if (error) throw error;
  return (data ?? []).map((r) => String((r as { document_id: string }).document_id)).filter(isValidUuid);
}

export async function addConversationDocument(conversationId: string, documentId: string, userId: string): Promise<void> {
  if (!supabase) throw new Error("Supabase 未配置");
  if (!isValidUuid(conversationId)) throw new Error("conversationId 无效");
  if (!isValidUuid(documentId)) throw new Error("documentId 无效");
  if (!isValidUuid(userId)) throw new Error("userId 无效");

  // 去重插入：若已存在则忽略（以查询兜底，避免依赖唯一索引）
  const { data: existing, error: existErr } = await supabase
    .from("conversation_documents")
    .select("id")
    .eq("conversation_id", conversationId)
    .eq("document_id", documentId)
    .eq("user_id", userId)
    .maybeSingle();
  if (existErr) throw existErr;
  if (existing) return;

  const { error } = await supabase
    .from("conversation_documents")
    .insert({ conversation_id: conversationId, document_id: documentId, user_id: userId });
  if (error) throw error;
}

export async function removeConversationDocument(conversationId: string, documentId: string, userId: string): Promise<void> {
  if (!supabase) throw new Error("Supabase 未配置");
  if (!isValidUuid(conversationId)) throw new Error("conversationId 无效");
  if (!isValidUuid(documentId)) throw new Error("documentId 无效");
  if (!isValidUuid(userId)) throw new Error("userId 无效");

  const { error } = await supabase
    .from("conversation_documents")
    .delete()
    .eq("conversation_id", conversationId)
    .eq("document_id", documentId)
    .eq("user_id", userId);
  if (error) throw error;
}

