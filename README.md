# Laila's Lab

Third-grade add/subtract-with-regrouping practice and exam simulator. One file, no build step.

- Math: pick one skill (IXL-style) or play a mix. Modes: Smart Practice, Guided Practice, Practice Exam (2:30 per question)
- Spelling: Unit 3 word lists (Weeks 1-3) with a Practice Test (read aloud), Look-Cover-Write, Complete the Word, Unscramble, Word Hunt, Fill the Sentence, Write a Sentence, Spot the Right Spelling; tricky words are tracked automatically
- Skills: times facts (2/5/10, 3/4, 6-9, mixed), multiples of 10, missing factor, equal-groups word problems, regrouping (2- and 3-digit, across zeros, 3-digit minus 2-digit), addition with regrouping, missing-number problems, word problems
- Football Club (extra, separate from schoolwork): NFL teams, locations, divisions and conferences, plus rules. Game Day Quiz, Division Draft, Rookie Rules, Meet the Teams. Bonus stars (daily double, perfect game, hot streak), a team card collection, division/conference prizes and closet items. Parent setting can hide it.
- Parent area (starting PIN 1234, stored per device): score history, mistake patterns, practice log
- Progress syncs through Firestore (project `lailas-math-lab`); it also keeps a copy in the browser.

## Setup
1. Host `index.html` anywhere static (this repo uses GitHub Pages).
2. Put your Firebase web config in `FB_CONFIG` inside `index.html`.
3. Publish `firestore.rules` (spelling uses mode `spell` and football uses mode `nfl`, so re-publish after updates) in the Firebase console (Firestore Database > Rules).
4. Restrict the Firebase API key to your site's address in Google Cloud Console.
