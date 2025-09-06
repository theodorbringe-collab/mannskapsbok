import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

export const SUPABASE_URL  = "https://yqiqvtuxwvgbcfpsoyno.supabase.co";
export const SUPABASE_ANON = "PASTE_YOUR_ANON_KEY";

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON);

// Minimal helpers for smoke-test
export async function ensureLocalUser(){
  let id = localStorage.getItem("mb_uid");
  if(!id){
    id=(crypto.randomUUID?.()||Math.random().toString(36).slice(2).padEnd(36,"0"));
    localStorage.setItem("mb_uid", id);
    localStorage.setItem("mb_email", `elev-${id.slice(0,8)}@local`);
    localStorage.setItem("mb_name",  `Elev ${id.slice(0,4)}`);
  }
  const email = localStorage.getItem("mb_email");
  const name  = localStorage.getItem("mb_name");
  await sb.from("profiles").upsert({ id, email, name }, { onConflict:"id" });
  return { id, email, name };
}

export async function listUsers(){
  const { data, error } = await sb.from("profiles").select("id,email,name").order("email",{ascending:true});
  if(error) throw error;
  return data||[];
}
