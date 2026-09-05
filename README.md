# ⁅𝐓𝐡𝐲𝐓☣︎𝐱𝐢𝐜𝐆𝐚𝐦𝐞𝐫⁆ Appeals, Tickets & TTS Records Center

Universal moderation appeal and case-tracking center for the ThyToxicGamer community.

## Current public release

**Ver. 1.0 — TTS Records update — September 5, 2026**

## Scope

- Individual appeals for Discord, Twitch, YouTube, Kick, X / Twitter, and Instagram
- Separate cases for bans, timeouts, mutes, kicks, warnings, blocks, restrictions, and other moderation actions
- Universal Appeals that create linked but independently decided cases
- Applicant status tracking
- Protected staff review portal for Owner, Admin, and Moderator roles
- Protected TTS Records for Free / Channel Points, Bits, and Donations
- Full searchable TTS transcripts retained for one year without Discord `.txt` attachments
- Owner-only individual TTS record deletion and Clear All

## Current phase

Twitch OAuth and passwordless email backup are connected through Supabase. Authenticated applicants can submit individual or Universal Appeals and privately track every resulting case. The protected staff queue supports Owner/Admin decisions, applicant-visible updates, Moderator notes, and audit history.

Run the SQL files in numerical order when setting up a new Supabase project. For an existing project, run only files newer than its last applied migration:

1. `001_initial_schema.sql`
2. `002_security_policies.sql`
3. `003_live_appeals.sql`
4. `004_rename_overseer_to_admin.sql`
5. `005_staff_case_controls.sql`
6. `006_owner_test_tickets.sql`
7. `007_archive_history_retention.sql`
8. `008_pending_moderation_queue.sql`
9. `009_owner_ticket_counter_reset.sql`
10. `010_discord_ticket_center.sql`
11. `011_ticket_service_role_permissions.sql`
12. `012_ticket_six_month_retention.sql`
13. `013_lock_linked_case_facts.sql`
14. `014_staff_review_permissions.sql`
15. `015_auto_archive_decisions.sql`
16. `016_auto_reverse_approved_appeals.sql`
17. `017_owner_archive_deletion.sql`
18. `018_tts_records.sql`
19. `019_tts_records_clear_fix.sql`

Closed-case data is automatically removed after six months by a daily Supabase Cron job. The Owner can create and permanently remove clearly marked test tickets from Staff Review; real appeals never expose that delete control.

## Discord notifications

The secret-authenticated `discord-appeal-events` Supabase Edge Function sends minimal alerts to the private staff channels. Discord receives only the case number, submission number, platform, action, status, event type, and protected Staff Review link. Applicant identity, explanations, evidence, messages, decision reasons, and private-note contents remain in the Appeals Center.

Store the two Discord webhook URLs only as Supabase Edge Function secrets:

- `DISCORD_APPEALS_WEBHOOK_URL`
- `DISCORD_APPEAL_LOGS_WEBHOOK_URL`
- `DATABASE_WEBHOOK_SECRET`

Create one Supabase Database Webhook on `public.appeal_logs` for `INSERT`, point it to `discord-appeal-events`, and send `Authorization: Bearer <DATABASE_WEBHOOK_SECRET>`. The dedicated secret grants no database access and is checked by the function before any work occurs. Direct evidence uploads are the next implementation phase.

## TTS Records

Deploy the `tts-records` Edge Function and set a long random `TTS_RECORDS_INGEST_KEY` Edge Function secret. Enter the same value once in Streamer.bot under **Records Settings**. The key stays protected on the local Windows account and is never included in the Streamer.bot import file.

Every completed, blocked, or interrupted live TTS entry uses the same protected schema regardless of whether it came from Free / Channel Points, Bits, or Donations. The Discord channel receives the clean embed and optional Twitch VOD link only. The full transcript is kept in Staff Review → TTS Records for one year. Moderator, Admin, and Owner accounts can search and read the records; only the Owner can delete one record or clear all records.

## Site

https://thy-toxic-gamer.github.io/appeals-center/
