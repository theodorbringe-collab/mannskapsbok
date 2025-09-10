import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

/* ---------- Supabase (din instans) ---------- */
export const SUPABASE_URL  = "https://yqiqvtuxwvgbcfpsoyno.supabase.co";
export const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlxaXF2dHV4d3ZnYmNmcHNveW5vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY4NDI1NjcsImV4cCI6MjA3MjQxODU2N30.JKgTfWJ6HqJ96P_ghVYP5vasph12yuk36jlfEBN3PBA";

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON);

/* ---------- Roller i katalogen ---------- */
export const ROLES = ["Fartøysjef","NK","Matros","Aspirant","Rescuerunner"];

/* ---------- Auth helpers ---------- */
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

/* ---------- Lokal identitet (fallback “elev”-modus) ---------- */
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
    const { data:secs } = await sb.from("sections")
      .select("id,title,position").eq("role",role).order("position",{ascending:true});

    // normaliser IDs til string
    const secsNorm = (secs||[]).map(s => ({ ...s, id: String(s.id) }));
    const list=[];

    if(secsNorm.length){
      const ids = secsNorm.map(s=>s.id);
      const { data:items } = await sb.from("items")
        .select("id,section_id,text,position")
        .in("section_id", ids).order("position",{ascending:true});

      // normaliser item-id og section_id til string
      const itemsNorm = (items||[]).map(i => ({ ...i, id:String(i.id), section_id:String(i.section_id) }));

      for(const s of secsNorm){
        list.push({ ...s, items: itemsNorm.filter(i=>i.section_id===s.id) });
      }
    }
    out[role]=list;
  }
  return out;
}

export async function loadMyProgress(uid){
  const { data } = await sb.from("progress")
    .select("item_id,done,date,signed_by")
    .eq("user_id", uid);
  const map = new Map();
  (data||[]).forEach(r=>map.set(String(r.item_id), r)); // String-nøkler
  return map;
}

export async function loadProgressFor(uid){
  const { data } = await sb.from("progress")
    .select("item_id,done,date,signed_by")
    .eq("user_id", uid);
  const map = new Map();
  (data||[]).forEach(r=>map.set(String(r.item_id), r)); // String-nøkler
  return map;
}

export async function loadComments(uid){
  const { data } = await sb.from("comments").select("id,author_id,text,created_at").eq("user_id",uid).order("created_at",{ascending:false});
  return data||[];
}

export async function loadLogs(limit=150){
  const { data } = await sb.from("logs").select("actor_id,message,created_at").order("created_at",{ascending:false}).limit(limit);
  return data||[];
}

/* ---------- Skriv / endre ---------- */
export async function upsertProgress(itemId, patch, uid){
  // aksepter både tall og uuid som id
  const item_id = (itemId==null ? "" : String(itemId).trim());
  if(!item_id) throw new Error("Mangler item_id");

  const row = {
    user_id: uid,
    item_id,                         // <-- ikke Number() !
    done: !!patch.done,
    date: patch.date || null,
    signed_by: patch.signed_by || null
  };

  const { error } = await sb.from("progress").upsert(row, { onConflict:"user_id,item_id" });
  if(error) { console.error("upsertProgress error", error); throw error; }
  await sb.from("logs").insert({ actor_id: uid, message: `progress updated for user ${uid}` });
}

/* ---------- Katalog-endringer ---------- */
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
