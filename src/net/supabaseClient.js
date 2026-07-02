// Supabase client, configured entirely from environment variables.
// No keys are ever hardcoded; see .env.example and the README.

import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// When env vars are missing the app still runs in local hot-seat mode;
// online play is simply disabled.
export const supabase = url && anonKey ? createClient(url, anonKey) : null;

export const onlineAvailable = () => supabase !== null;
