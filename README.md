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

Discord notifications are pending final approval of the private data allowed in each staff channel. Direct evidence uploads are the next implementation phase.

## Site

https://thy-toxic-gamer.github.io/appeals-center/
