# Laila's Math Lab

Third-grade add/subtract-with-regrouping practice and exam simulator. One file, no build step.

- Modes: Smart Practice, Guided Practice, Practice Exam
- Skills: regrouping (2- and 3-digit, across zeros, 3-digit minus 2-digit), addition with regrouping, missing-number problems, word problems
- Parent area (starting PIN 1234, stored per device): score history, mistake patterns, practice log
- Progress syncs through Firestore (project `lailas-math-lab`); it also keeps a copy in the browser.

## Setup
1. Host `index.html` anywhere static (this repo uses GitHub Pages).
2. Put your Firebase web config in `FB_CONFIG` inside `index.html`.
3. Publish `firestore.rules` in the Firebase console (Firestore Database > Rules).
4. Restrict the Firebase API key to your site's address in Google Cloud Console.
