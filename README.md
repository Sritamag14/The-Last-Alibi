# THE LAST ALIBI

A room-code mystery game for 2–8 players with twelve authored cases, Duo Mode, and Multiplayer Mode.

## Run locally

Requires Node.js 22 or newer.

```sh
node server.js
```

Open http://localhost:4173. For devices on the same Wi-Fi, open the host computer's LAN address on port 4173. Create a room and share its five-character code. Local Node sessions use the existing in-memory backend and SSE transport; restarting that server clears local rooms.

## Publish on Netlify

The Netlify version uses `netlify/functions/game.ts` for game actions and polling, and stores room records in the site-wide Netlify Blobs store with strong consistency and conditional writes. Rooms expire after seven days without activity. No external database, site secrets, or manually configured environment variables are required.

1. Download and unzip `netlify-ready-game.zip` into a folder.
2. Sign in to Netlify, open Netlify Drop, and drag the extracted project folder (not only `public/`) into the deploy area.
3. Wait for the signed-in project build to finish. The root `netlify.toml` sets the publish folder, function folder, Node version, and build command.
4. Open the assigned Netlify URL. Share that URL and the five-character room code with players.

Netlify must build the project while you are signed in so it can bundle and deploy the Function. Review the site's audience setting before sharing the URL publicly. Room data is scoped to the Netlify site and accessed only by the Function; player tokens remain in browser session storage and are sent in POST bodies.

The existing scoring, cases, roles, clues, votes, and reveal logic remain authored in the project. The Function only advances phases and persists server-validated game actions; clients cannot submit scores or unrevealed solutions.


### Final polish update

Duo NPC interrogation now selects a case-grounded response using the question category and wording (motive, timeline/alibi, evidence, or secret/evasive response) instead of repeating the same alibi for every question. The phase navigation also has a restrained antique dossier treatment.
