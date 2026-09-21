import {createClient} from '@supabase/supabase-js';
const url=import.meta.env.VITE_SUPABASE_URL;
const key=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
let remember=true;
export function rememberSession(value) { remember=value; }
const storage={
  getItem(name) { return sessionStorage.getItem(name) ?? localStorage.getItem(name); },
  setItem(name,value) {
    // Preserve the storage choice when the SDK refreshes a token after a reload.
    const useSession=sessionStorage.getItem(name)!==null || (!remember && localStorage.getItem(name)===null);
    (useSession?sessionStorage:localStorage).setItem(name,value);
    (useSession?localStorage:sessionStorage).removeItem(name);
  },
  removeItem(name) { localStorage.removeItem(name); sessionStorage.removeItem(name); }
};
export const client=url && key ? createClient(url,key,{auth:{storage,persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}}) : null;
