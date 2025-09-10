import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

/* ---------- Supabase (din instans) ---------- */
export const SUPABASE_URL  = "https://yqiqvtuxwvgbcfpsoyno.supabase.co";
export const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlxaXF2dHV4d3ZnYmNmcHNveW5vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY4NDI1NjcsImV4cCI6MjA3MjQxODU2N30.JKgTfWJ6HqJ96P_ghVYP5vasph12yuk36jlfEBN3PBA";

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON);

/* ---------- Roller ---------- */
export const ROLES = ["Fartøysjef","NK","Matros","Aspirant","Rescuerunner"];

/* ---------- Hjelpere ---------- */
function pickKey(obj, keys){
  for(const k of keys){ if(obj && obj[k] != null) return String(obj[k]); }
  return "";
}
function err(msg){ console.error(msg); return new Error(msg); }

/* ---------- Auth ---------- */
export async function ensureUser(){
  const { data, error } = await sb.auth.getUser();
  const user = data?.user;
  if (error || !user) throw new Error("Not signed in");
  const id = user.id;
  const email = user.email || `user-${id.slice(0,8)}@local`;
  const name = user.user_metadata?.name || user.user_metadata?.full_name || email;
  await sb.from("profiles").upsert({ id, email, name }, { onConflict: "id" });
  return { id, email, name };
}

/* ---------- Lokal identitet (fallback) ---------- */
export function getLocalIdentity(){
  return {
    id:    localStorage.getItem("mb_uid"),
    email: localStorage.getItem("mb_email"),
    name:  localStorage.getItem("mb_name"),
  };
}
export async function ensureLocalUser(){
  let id = localStorage.getItem("mb_uid");
  if(!id){
    id = (crypto.randomUUID?.()
      || "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g,c=>{
          const r=Math.random()*16|0, v=c==="x"?r:(r&0x3|0x8); return v.toString(16);
        }));
    localStorage.setItem("mb_uid", id);
    localStorage.setItem("mb_email", `elev-${id.slice(0,8)}@local`);
    localStorage.setItem("mb_name",  `Elev ${id.slice(0,4)}`);
  }
  const email = localStorage.getItem("mb_email");
  const name  = localStorage.getItem("mb_name");
  await sb.from("profiles").upsert({ id, email, name }, { onConflict:"id" });
  return { id, email, name };
}
export async function setLocalIdentity({ name, email }){
  const me = await ensureLocalUser();
  const patch = {};
  if(name?.trim()){  localStorage.setItem("mb_name",  name.trim());  patch.name  = name.trim(); }
  if(email?.trim()){ localStorage.setItem("mb_email", email.trim()); patch.email = email.trim(); }
  if(Object.keys(patch).length){
    await sb.from("profiles").upsert({ id: me.id, ...patch }, { onConflict:"id" });
  }
  return { id: me.id, ...getLocalIdentity() };
}

/* ---------- Lesing ---------- */
export async function listUsers(){
  const { data, error } = await sb.from("profiles").select("id,email,name").order("email",{ascending:true});
  if(error) throw error;
  return data||[];
}

export async function loadCatalog(){
  const out = {};
  for(const role of ROLES){
    // vi henter * for å støtte ulike skjemanavn
    const { data:secsRaw, error:secErr } = await sb.from("sections")
      .select("*").eq("role",role).order("position",{ascending:true});
    if(secErr) throw secErr;

    const secs = (secsRaw||[]).map(s => ({
      ...s,
      id: pickKey(s, ["id","section_id","sid","uuid"]) // normaliser
    }));

    const list=[];
    if(secs.length){
      const secIds = secs.map(s=>s.id);
      const { data:itemsRaw, error:itErr } = await sb.from("items")
        .select("*").in("section_id", secIds).order("position",{ascending:true});
      if(itErr) throw itErr;

      const items = (itemsRaw||[]).map(i => ({
        ...i,
        id: pickKey(i, ["id","item_id","iid","uuid"]),
        section_id: pickKey(i, ["section_id","sid","sectionId"])
      }));

      for(const s of secs){
        list.push({ ...s, items: items.filter(i=>i.section_id===s.id) });
      }
    }
    out[role]=list;
  }
  return out;
}

export async function loadMyProgress(uid){
  const { data, error } = await sb.from("progress")
    .select("item_id,done,date,signed_by").eq("user_id", uid);
  if(error) throw error;
  const map = new Map();
  (data||[]).forEach(r=>map.set(String(r.item_id), r));
  return map;
}
export async function loadProgressFor(uid){
  const { data, error } = await sb.from("progress")
    .select("item_id,done,date,signed_by").eq("user_id", uid);
  if(error) throw error;
  const map = new Map();
  (data||[]).forEach(r=>map.set(String(r.item_id), r));
  return map;
}

export async function loadComments(uid){
  const { data, error } = await sb.from("comments").select("id,author_id,text,created_at").eq("user_id",uid).order("created_at",{ascending:false});
  if(error) throw error;
  return data||[];
}
export async function loadLogs(limit=150){
  const { data, error } = await sb.from("logs").select("actor_id,message,created_at").order("created_at",{ascending:false}).limit(limit);
  if(error) throw error;
  return data||[];
}

/* ---------- Skriv / endre ---------- */
export async function upsertProgress(itemId, patch, uid){
  const item_id = String(itemId ?? "").trim();      // støtter UUID/tekst
  if(!item_id) throw err("Mangler item_id");

  const row = {
    user_id: uid,
    item_id,
    done: !!patch.done,
    date: patch.date || null,
    signed_by: patch.signed_by || null
  };
  const { error } = await sb.from("progress").upsert(row, { onConflict:"user_id,item_id" });
  if(error) { console.error("upsertProgress error", error); throw error; }
  await sb.from("logs").insert({ actor_id: uid, message: `progress updated for user ${uid}` });
}

/* ---------- Katalog-endringer (brukes i admin) ---------- */
export async function addComment(uid, text, authorId){
  const { error } = await sb.from("comments").insert({ user_id: uid, author_id: authorId, text });
  if(error) throw error;
  await sb.from("logs").insert({ actor_id: authorId, message: `comment added for user ${uid}` });
}
export async function addSection(role){
  const { error } = await sb.from("sections").insert({ role, title:"Ny inndeling", position: Date.now() });
  if(error) throw error;
}
export async function updateSectionTitle(id, title){
  const { error } = await sb.from("sections").update({ title }).eq("id", id);
  if(error) throw error;
}
export async function deleteSection(id){
  const { error } = await sb.from("sections").delete().eq("id", id);
  if(error) throw error;
}
export async function moveSection(aId,aPos,bId,bPos){
  let r = await sb.from("sections").update({ position:bPos }).eq("id", aId);
  if(r.error) throw r.error;
  r = await sb.from("sections").update({ position:aPos }).eq("id", bId);
  if(r.error) throw r.error;
}
export async function addItem(section_id, text){
  const { error } = await sb.from("items").insert({ section_id, text, position: Date.now() });
  if(error) throw error;
}
export async function editItem(id, text){
  const { error } = await sb.from("items").update({ text }).eq("id", id);
  if(error) throw error;
}
export async function deleteItem(id){
  const { error } = await sb.from("items").delete().eq("id", id);
  if(error) throw error;
}
export async function moveItem(aId,aPos,bId,bPos){
  let r = await sb.from("items").update({ position:bPos }).eq("id", aId);
  if(r.error) throw r.error;
  r = await sb.from("items").update({ position:aPos }).eq("id", bId);
  if(r.error) throw r.error;
}
