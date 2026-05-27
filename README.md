# School Supply Giveaway Form with Voting

This app now has two parts:

1. **Entry Form** (unlimited users until deadline)
2. **Voting Page** where voters provide **name, age, and location** before they can vote.

Each vote gives **10 points**. The **top 2 users** with the highest votes/points are the winners and receive **₱200 each**.

Entry form is open until **May 30, 2026** with a live countdown timer on the frontend.

## Required SQL

Please run the SQL from `database.sql` in your Supabase SQL Editor.

## Notes

- Ensure your `/api/config` still returns: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `GOOGLE_MAPS_API_KEY`.
- If RLS is enabled, add policies for:
  - inserting to `giveaway_entries`
  - reading `giveaway_entries`
  - inserting to `entry_votes`
