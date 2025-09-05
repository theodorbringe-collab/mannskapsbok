// Felles datalag for elev + admin (ESM)
// Importerer Supabase som ESM direkte fra jsDelivr (ingen bundler nødvendig)
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

// --- KONFIG: sett prosjektet ditt her (du har ny URL og anon key) ---
export const SUPABASE_URL  = "https://vogqypnvsifswjmvuptn.supabase.co";
export const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZvZ3F5cG52c2lmc3dqbXZ1cHRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTcwNzIwMDIsImV4cCI6MjA3MjY0ODAwMn0.CbB58BW4f4O-VzU88DI3hae5PxaptK8Fl6BIsch9Tto";
// -------------------------------------------------------------------

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON);
export const ROLES = ["Fartøysjef","NK","Matros","Aspirant","Rescuerunner"];

/** Lokal "elev" uten auth – oppretter profilrad basert på localStorage */
export async function ensureLocalUser() {
  let id = localStorage.getItem("mb_uid");
  if (!id) {
    id = (crypto.randomUUID?.() ||
      "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
        const r = Math.random()*16|0, v = c === "x" ? r : (r & 0x3 | 0x8); return v.toString(16);
      }));
    localStorage.setItem("mb_uid", id);
    localStorage.setItem("mb_email", `elev-${id.slice(0,8)}@local`);
    localStorage.setItem("mb_name",  `Elev ${id.slice(0,4)}`);
  }
  const email = localStorage.getItem("mb_email") || `elev-${id.slice(0,8)}@local`;
  const name  = localStorage.getItem("mb_name")  || email;
  await sb.from("profiles").upsert({ id, email, name }, { onConflict: "id" });
  return { id, email, name };
}

// ---------- Lesing ----------
export async function listUsers() {
  const { data, error } = await sb.from("profiles").select("id,email,name").order("email", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function loadCatalog() {
  const out = {};
  for (const role of ROLES) {
    const { data: secs } = await sb.from("sections").select("id,title,position").eq("role", role).order("position", { ascending: true });
    const list = [];
    if (secs?.length) {
      const ids = secs.map(s => s.id);
      const { data: items } = await sb.from("items")
        .select("id,section_id,text,position")
        .in("section_id", ids)
        .order("position", { ascending: true });
      for (const s of secs) list.push({ id: s.id, title: s.title, position: s.position, items: (items||[]).filter(i => i.section_id === s.id) });
    }
    out[role] = list;
  }
  return out;
}

export async function loadMyProgress(uid) {
  const { data, error } = await sb.from("progress").select("item_id,done,date,signed_by").eq("user_id", uid);
  if (error) throw error;
  const map = new Map(); (data||[]).forEach(r => map.set(r.item_id, r));
  return map;
}
export async function loadProgressFor(uid) {
  const { data } = await sb.from("progress").select("item_id,done,date,signed_by").eq("user_id", uid);
  const map = new Map(); (data||[]).forEach(r => map.set(r.item_id, r));
  return map;
}
export async function loadComments(uid) {
  const { data } = await sb.from("comments").select("id,author_id,text,created_at").eq("user_id", uid).order("created_at", { ascending: false });
  return data || [];
}
export async function loadLogs(limit=200) {
  const { data } = await sb.from("logs").select("actor_id,message,created_at").order("created_at", { ascending: false }).limit(limit);
  return data || [];
}

// ---------- Skriv / endre ----------
export async function upsertProgress(itemId, patch, uid) {
  const row = { user_id: uid, item_id: itemId, done: !!patch.done, date: patch.date || null, signed_by: patch.signed_by || null };
  const { error } = await sb.from("progress").upsert(row, { onConflict: "user_id,item_id" });
  if (error) throw error;
  await sb.from("logs").insert({ actor_id: uid, message: `progress updated for user ${uid}` });
}

export async function addComment(uid, text, authorId) {
  const { error } = await sb.from("comments").insert({ user_id: uid, author_id: authorId, text });
  if (error) throw error;
  await sb.from("logs").insert({ actor_id: authorId, message: `comment added for user ${uid}` });
}

export async function addSection(role) {
  const { error } = await sb.from("sections").insert({ role, title: "Ny inndeling", position: Date.now() });
  if (error) throw error;
}
export async function updateSectionTitle(id, title) {
  const { error } = await sb.from("sections").update({ title }).eq("id", id);
  if (error) throw error;
}
export async function deleteSection(id) {
  const { error } = await sb.from("sections").delete().eq("id", id);
  if (error) throw error;
}
export async function moveSection(aId, aPos, bId, bPos) {
  let r = await sb.from("sections").update({ position: bPos }).eq("id", aId);
  if (r.error) throw r.error;
  r = await sb.from("sections").update({ position: aPos }).eq("id", bId);
  if (r.error) throw r.error;
}

export async function addItem(section_id, text) {
  const { error } = await sb.from("items").insert({ section_id, text, position: Date.now() });
  if (error) throw error;
}
export async function editItem(id, text) {
  const { error } = await sb.from("items").update({ text }).eq("id", id);
  if (error) throw error;
}
export async function deleteItem(id) {
  const { error } = await sb.from("items").delete().eq("id", id);
  if (error) throw error;
}
export async function moveItem(aId, aPos, bId, bPos) {
  let r = await sb.from("items").update({ position: bPos }).eq("id", aId);
  if (r.error) throw r.error;
  r = await sb.from("items").update({ position: aPos }).eq("id", bId);
  if (r.error) throw r.error;
}

