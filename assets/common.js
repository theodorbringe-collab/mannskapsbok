import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

/* Supabase-prosjektet ditt */
export const SUPABASE_URL  = "https://yqiqvtuxwvgbcfpsoyno.supabase.co";
export const SUPABASE_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlxaXF2dHV4d3ZnYmNmcHNveW5vIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY4NDI1NjcsImV4cCI6MjA3MjQxODU2N30.JKgTfWJ6HqJ96P_ghVYP5vasph12yuk36jlfEBN3PBA";
export const sb = createClient(SUPABASE_URL, SUPABASE_ANON);

/* Roller */
export const ROLES = ["Fartøysjef","NK","Matros","Aspirant","Rescuerunner"];

/* ---- Auth ---- */
export async function ensureUser(){
  const { data:{ user } } = await sb.auth.getUser();
  if(!user) throw new Error("Not signed in");
  const profile = {
    id: user.id,
    email: user.email || "",
    name:  user.user_metadata?.name || user.user_metadata?.full_name || user.email || ""
  };
  await sb.from("profiles").upsert(profile, { onConflict: "id" });
  return profile;
}
export async function ensureUserOrRedirect(){
  const { data:{ user } } = await sb.auth.getUser();
  if(user){
    return ensureUser();
  }else{
    const ret = encodeURIComponent(location.pathname + location.search);
    location.replace(`./login.html?returnTo=${ret}`);
    throw new Error("Redirecting to login");
  }
}

// Send e-postkode (og/eller magisk lenke)
export async function signInEmailOtp(email){
  const { error } = await sb.auth.signInWithOtp({
    email,
    options:{
      shouldCreateUser: true,
      emailRedirectTo: `${location.origin}${location.pathname.replace('login.html','elev.html')}`
    }
  });
  if(error) throw error;
}
// Verifiser 6-sifret kode fra e-post
export async function verifyEmailOtp(email, token){
  const { error } = await sb.auth.verifyOtp({ email, token, type: 'email' });
  if(error) throw error;
}
export async function signOut(){ await sb.auth.signOut(); }

// Oppdater profilnavn/e-post (lagres i profiles)
export async function updateProfile({ name, email }){
  const { data:{ user } } = await sb.auth.getUser();
  if(!user) throw new Error("Not signed in");
  const row = { id:user.id };
  if(name)  row.name  = name;
  if(email) row.email = email;
  const { error } = await sb.from("profiles").upsert(row, { onConflict:"id" });
  if(error) throw error;
  return row;
}

/* ---- Utils for ID ---- */
function pickKey(obj, keys){ for(const k of keys){ if(obj && obj[k]!=null) return String(obj[k]); } return ""; }

/* ---- Lesing ---- */
export async function listUsers(){
  const { data, error } = await sb.from("profiles").select("id,email,name").order("email",{ascending:true});
  if(error) throw error;
  return data||[];
}
export async function loadCatalog(){
  const out = {};
  for(const role of ROLES){
    const { data:secsRaw, error:secErr } = await sb.from("sections").select("*").eq("role",role).order("position",{ascending:true});
    if(secErr) throw secErr;
    const secs = (secsRaw||[]).map(s=>({ ...s, id: pickKey(s,["id","section_id","sid","uuid"]) }));
    const list=[];
    if(secs.length){
      const secIds = secs.map(s=>s.id);
      const { data:itemsRaw, error:itErr } = await sb.from("items").select("*").in("section_id", secIds).order("position",{ascending:true});
      if(itErr) throw itErr;
      const items = (itemsRaw||[]).map(i=>({ ...i, id:pickKey(i,["id","item_id","iid","uuid"]), section_id:pickKey(i,["section_id","sid","sectionId"]) }));
      for(const s of secs){ list.push({ ...s, items: items.filter(i=>i.section_id===s.id) }); }
    }
    out[role]=list;
  }
  return out;
}
export async function loadMyProgress(uid){
  const { data, error } = await sb.from("progress").select("item_id,done,date,signed_by").eq("user_id", uid);
  if(error) throw error;
  const map = new Map(); (data||[]).forEach(r=>map.set(String(r.item_id), r));
  return map;
}
export async function loadProgressFor(uid){
  const { data, error } = await sb.from("progress").select("item_id,done,date,signed_by").eq("user_id", uid);
  if(error) throw error;
  const map = new Map(); (data||[]).forEach(r=>map.set(String(r.item_id), r));
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

/* ---- Skriv / endre ---- */
export async function upsertProgress(itemId, patch, uid){
  const item_id = String(itemId ?? "").trim(); if(!item_id) throw new Error("Mangler item_id");
  const row = { user_id: uid, item_id, done: !!patch.done, date: patch.date || null, signed_by: patch.signed_by || null };
  const { error } = await sb.from("progress").upsert(row, { onConflict:"user_id,item_id" });
  if(error) throw error;
  await sb.from("logs").insert({ actor_id: uid, message: `progress updated for user ${uid}` });
}
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
  let r = await sb.from("sections").update({ position:bPos }).eq("id", aId); if(r.error) throw r.error;
  r = await sb.from("sections").update({ position:aPos }).eq("id", bId); if(r.error) throw r.error;
}
export async function addItem(section_id, text){
  const { error } = await sb.from("items").insert({ section_id, text, position: Date.now() }); if(error) throw error;
}
export async function editItem(id, text){
  const { error } = await sb.from("items").update({ text }).eq("id", id); if(error) throw error;
}
export async function deleteItem(id){
  const { error } = await sb.from("items").delete().eq("id", id); if(error) throw error;
}
export async function moveItem(aId,aPos,bId,bPos){
  let r = await sb.from("items").update({ position:bPos }).eq("id", aId); if(r.error) throw r.error;
  r = await sb.from("items").update({ position:aPos }).eq("id", bId); if(r.error) throw r.error;
}
/* ==== Email/Password auth ==== */

// Registrer ny bruker (kan kreve e-postbekreftelse hvis aktivert)
export async function signUpWithPassword(email, password){
  const redirect = `${location.origin}${location.pathname.replace('login.html','elev.html')}`;
  const { data, error } = await sb.auth.signUp({
    email, password,
    options: { emailRedirectTo: redirect }
  });
  if(error) throw error;
  return data; // data.session kan være null hvis "Confirm email" er på
}

// Logg inn med e-post + passord
export async function signInWithPassword(email, password){
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if(error) throw error;
}

// Send "glemt passord" e-post
export async function sendPasswordReset(email){
  const redirectTo = `${location.origin}${location.pathname.replace('login.html','reset.html')}`;
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
  if(error) throw error;
}

// Etter klikk på reset-lenke -> sett nytt passord
export async function updatePassword(newPassword){
  const { data, error } = await sb.auth.updateUser({ password: newPassword });
  if(error) throw error;
  return data;
}

// Sørg for innlogget bruker eller redirect til login
export async function ensureUserOrRedirect(){
  const { data:{ user } } = await sb.auth.getUser();
  if(user){
    await sb.from("profiles").upsert({
      id: user.id,
      email: user.email || "",
      name:  user.user_metadata?.name || user.user_metadata?.full_name || user.email || ""
    }, { onConflict: "id" });
    return { id:user.id, email:user.email, name:user.user_metadata?.name || user.user_metadata?.full_name || user.email };
  }else{
    const ret = encodeURIComponent(location.pathname + location.search);
    location.replace(`./login.html?returnTo=${ret}`);
    throw new Error("Redirecting to login");
  }
}

export async function signOut(){
  await sb.auth.signOut();
}

