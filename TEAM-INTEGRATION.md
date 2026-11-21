# Put the three parts together

Repository name: **labmesh**. Start with the contents of this folder at the repository root. The lead owns server/, the extension launcher, app.js, transport.js, shell.css and the Gemini panel outside #app. The transfer teammate owns extension/engine.js, extension/engine/ and their tests. The frontend teammate owns extension/ui.js, extension/styles.css, their UI assets and tests. Each person starts from the same lead commit.

## Get both branches onto the same starting point

1. Lead creates an empty public GitHub repository named labmesh and pushes this folder to its main branch. If GitHub already contains a README, clone the existing repository first and copy the files into it. Keep the existing history.
2. Teammates clone the actual repository URL. The engine teammate runs `git switch -c feature/transfer-engine`; the UI teammate runs `git switch -c feature/room-ui`. Give them their corresponding brief in team/. Those briefs include the shared state shape, permitted paths and acceptance tests.
3. Each teammate commits their files, pushes their branch and opens a pull request into main. Merge the engine and UI pull requests. They can merge in either order. Pull main on all three laptops, reload the extension in chrome://extensions and reopen room tabs. The lead build discovers both ES modules on page load. The extension folder itself is the build output.

## Engine teammate

Export `createEngine({selfId,hostId,send,onState})` from extension/engine.js. Return onPeer, share, pause, resume, getVerifiedBlob and close. send(peerId,payload) returns a Promise and accepts ordered text or ArrayBuffer. onPeer receives open/close/data events. Own the chunk protocol and async processing order inside the engine. Return the local verified Blob only after whole-file SHA-256 passes. Key integration detail: include self and all known peers in each state snapshot. have is an array of distinct verified zero-based indices. Preserve departed peers with online=false. Notify onState when verification, pause, coverage or readiness changes. The room guide derives its facts from this same snapshot.

## Frontend teammate

Export `mount(root,actions)` from extension/ui.js. Return render(state) and destroy(). Render inside root (#app). Keep the separate #advisor panel available below it. Put CSS in extension/styles.css, scope selectors to #app, and call actions with the arguments in your brief. Create/join defaults to ws://127.0.0.1:8765/ws. A verified save uses actions.save(). The composition root handles actual downloads and the Gemini request. You can implement against fixtures while the engine teammate works.

## Integration sequence

| Check | What proves it works |
| --- | --- |
| Lead build only | Start B, load extension, create/join on A/B/C. All peers appear. Ask Gemini on B and see a model-labelled answer after setting a valid key. |
| Engine merged | Run the engine teammate's corrupt-chunk, duplicate, early-disconnect and complete-file checks. For manual file selection merge the UI too. |
| Both merged | A selects demo/workshop.bin in normal mode. B saves it after Verified. Independently hash the downloaded file. |
| Three-peer demo | Switch to a fresh room in staged mode, join all three first, then select the file. Wait for the real readiness indicator. Close A's room tab while B keeps the coordinator alive. B and C finish, save and independently match A's digest. |
| Early departure | Repeat, removing A before receivers jointly have all chunks. The UI must show missing coverage if a unique chunk vanished. |
| Gemini category | Try the guide before and after A leaves. Check that the answer is grounded in the counts at click time. Capture an actual successful response for the judges. |

Generate the 1 MiB demo asset with `python demo/fixture.py`. Its SHA-256 is `fbbab289f7f94b25736c58be46a994c441fd02552cc6022352e3d86d2fab7c83`. On Windows use `Get-FileHash -Algorithm SHA256 -LiteralPath 'path-to-saved-file'`.

Run the lead tests from the repository root with `.\.venv\Scripts\python -m unittest discover -s tests -p test_lead.py`. They exercise the coordinator and the Gemini adapter with a substituted Google response. A live Gemini test needs a valid key on B.

## Two-minute live demo

Lead opens a room and explains the community workshop use case. Frontend teammate projects B's real chunk strips. Engine teammate points out which verified pieces B and C each hold. Have a judge close A's room tab once the real readiness indicator permits it. Show B and C completing and match their saved hashes. Click the Gemini guide to explain what the instructor is seeing, in Sinhala or English. For Community Impact keep the repo public, with the license and run instructions. For the Gemini track verify all teammates are 18+, add the project number and AI disclosure, and confirm the OrganizerHQ card appears under the selected challenges.
