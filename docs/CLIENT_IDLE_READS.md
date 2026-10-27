# Idle-client reads

Browser and Android automatic read polling pauses after 30 minutes without local
interaction. Pointer, touch, keyboard, input and wheel events renew activity;
returning focus or making the app visible resumes reads. Reconnecting the network
or receiving an automatic policy update does not by itself wake an idle client.

One shared listener set serves all pollers in the current client. Each reader
remains non-overlapping and resumes once when due. In-flight work may finish;
manual refresh remains available. No inactivity sign-out, draft clearing, session
revocation, server-side suspension or financial-data mutation is performed.

Offline transaction delivery remains enabled for pending writes. An empty offline
queue only reads local storage, not Neon. Automatic update discovery also respects
client inactivity; manual update checking is unchanged.

This does not force the database to sleep while another user is working. Neon
controls scale-to-zero after database activity stops, with its own idle delay.
Scheduled posting, reminder delivery, health probes, backups and administrative
database tools may legitimately wake the database independently of client activity.
The server scheduler's existing Upstash due-time gate is unchanged; scheduled
financial work must not depend on a user being signed in.

Reducing wake-ups does not restore an exhausted quota or guarantee uninterrupted
service on a free plan. Existing APKs need the client update for inactivity pausing.
