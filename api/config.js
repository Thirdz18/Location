export default function handler(req, res) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
  const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY;

  if (!supabaseUrl || !supabaseAnonKey || !googleMapsApiKey) {
    return res.status(500).json({
      error:
        'Missing SUPABASE_URL, SUPABASE_ANON_KEY, or GOOGLE_MAPS_API_KEY in Vercel environment variables.'
    });
  }

  return res.status(200).json({
    supabaseUrl,
    supabaseAnonKey,
    googleMapsApiKey
  });
}
