# ⁅𝐓𝐡𝐲𝐓☣︎𝐱𝐢𝐜𝐆𝐚𝐦𝐞𝐫⁆ Appeals Center

Universal moderation appeal and case-tracking center for the ThyToxicGamer community.

## Scope

- Individual appeals for Discord, Twitch, YouTube, Kick, X / Twitter, and Instagram
- Separate cases for bans, timeouts, mutes, kicks, warnings, blocks, restrictions, and other moderation actions
- Universal Appeals that create linked but independently decided cases
- Applicant status tracking
- Protected staff review portal for Owner, Admin, and Moderator roles

## Current phase

Twitch OAuth and passwordless email backup are connected through Supabase. Authenticated applicants can submit individual or Universal Appeals and privately track every resulting case. The protected staff queue supports Owner/Admin decisions, applicant-visible updates, Moderator notes, and audit history.

Run the SQL files in numerical order when setting up a new Supabase project:

1. `001_initial_schema.sql`
2. `002_security_policies.sql`
3. `003_live_appeals.sql`
4. `004_rename_overseer_to_admin.sql`
5. `005_staff_case_controls.sql`
6. `006_owner_test_tickets.sql`

Closed-case data is automatically removed after six months by a daily Supabase Cron job. The Owner can create and permanently remove clearly marked test tickets from Staff Review; real appeals never expose that delete control.

## Discord notifications

The secret-authenticated `discord-appeal-events` Supabase Edge Function sends minimal alerts to the private staff channels. Discord receives only the case number, submission number, platform, action, status, event type, and protected Staff Review link. Applicant identity, explanations, evidence, messages, decision reasons, and private-note contents remain in the Appeals Center.

Store the two Discord webhook URLs only as Supabase Edge Function secrets:

- `DISCORD_APPEALS_WEBHOOK_URL`
- `DISCORD_APPEAL_LOGS_WEBHOOK_URL`
- `DATABASE_WEBHOOK_SECRET`

Create one Supabase Database Webhook on `public.appeal_logs` for `INSERT`, point it to `discord-appeal-events`, and send `Authorization: Bearer <DATABASE_WEBHOOK_SECRET>`. The dedicated secret grants no database access and is checked by the function before any work occurs. Direct evidence uploads are the next implementation phase.

## Site

https://thy-toxic-gamer.github.io/appeals-center/
