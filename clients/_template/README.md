# New client in five minutes

    cp -r clients/_template clients/<name>

1. `client.json` — fill it in. `theme` picks which film they get.
2. `assets/` — drop in `monogram.png`, `couple.jpg`, and `song.m4a` + `song.mp3`
   (names must match `logo`, `photo.src` and `music.file`).
3. `node tools/build.mjs <name>` then serve `dist/` and look at it.
4. New Vercel project → same repo → Build Command `node tools/build.mjs $CLIENT`,
   Output Directory `dist`, environment variable `CLIENT=<name>`.

Nothing in `engine/` should need touching. If it does, that is a gap in the
theme or the block templates, not a client problem.
