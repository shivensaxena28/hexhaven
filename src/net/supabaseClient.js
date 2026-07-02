// Supabase client, configured entirely from environment variables.
// No keys are ever hardcoded; see .env.example and the README.

import { createClient } from '@supabase/supabase-js';

// Normalize the project URL so common copy-paste mistakes still work:
// surrounding whitespace/quotes, a trailing slash, or an accidental service
// path suffix like /rest/v1. The correct form is https://<ref>.supabase.co
function normalizeUrl(raw) {
  if (!raw) return null;
  let url = String(raw).trim().replace(/^["']|["']$/g, '');
  url = url.replace(/\/+$/, '');
  url = url.replace(/\/(rest|auth|realtime|storage|functions)\/v\d+.*$/, '');
  if (!/^https:\/\//.test(url) && /^[a-z0-9-]+\.supabase\./.test(url)) {
    url = `https://${url}`;
  }
  if (/supabase\.com\/dashboard/.test(url)) {
    console.error(
      'VITE_SUPABASE_URL looks like a dashboard link. Use your Project URL '
      + 'instead — https://<project-ref>.supabase.co (Settings -> Data API).',
    );
    return null;
  }
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in|net|red)$/i.test(url)) {
    console.error(
      `VITE_SUPABASE_URL does not look like a Supabase project URL: "${url}". `
      + 'Expected https://<project-ref>.supabase.co (Settings -> Data API -> Project URL).',
    );
    return null;
  }
  return url;
}

function normalizeKey(raw) {
  if (!raw) return null;
  const key = String(raw).trim().replace(/^["']|["']$/g, '');
  if (/^https:\/\//.test(key)) {
    console.error('VITE_SUPABASE_ANON_KEY looks like a URL — the URL and key values are probably swapped.');
    return null;
  }
  if (/^sb_secret_/.test(key)) {
    console.error(
      'VITE_SUPABASE_ANON_KEY is a SECRET key. Never put the secret key in '
      + 'frontend code — use the Publishable key (sb_publishable_...) instead, '
      + 'and rotate the secret key in the Supabase dashboard now.',
    );
    return null;
  }
  return key;
}

const url = normalizeUrl(import.meta.env.VITE_SUPABASE_URL);
const anonKey = normalizeKey(import.meta.env.VITE_SUPABASE_ANON_KEY);

// When env vars are missing the app still runs in local hot-seat mode;
// online play is simply disabled.
export const supabase = url && anonKey ? createClient(url, anonKey) : null;

export const onlineAvailable = () => supabase !== null;
