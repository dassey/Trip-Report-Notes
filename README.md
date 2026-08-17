# Trip Report Notes

A one-page web app for writing a trip report from a phone. Three ways to start:

- **Create Mission** — no Word file needed. Name, role, locations and dates, and it
  builds the report itself: one page per day between the dates.
- **Upload Mission** — a mission file saved from this app. A created mission carries
  everything, so it picks up where it left off on any phone.
- **Upload Template** — the mission's `.docx`. Pick your name from the SME headings and
  the finished document keeps your section only.

Nothing is uploaded. The template, your notes and the finished document never leave the
phone — the Word file is written in the browser.

## Getting it on an iPhone

**<https://dassey.github.io/Trip-Report-Notes/>**

1. Open that in Safari on the phone.
2. Tap **Share → Add to Home Screen**. It opens full screen, with no address bar, and
   works with no signal after the first visit.

Pages is on, serving the repository root of `main`, so every push to `main`
republishes the site. A fresh fork needs it turned on once: **Settings → Pages →
Build and deployment → Deploy from a branch → `main` / (root)**.

Do not AirDrop `index.html` and open it from Files — Safari blocks storage on
`file://`, so notes will not be kept. It has to be served over `https`.

### iPhone notes

- **Home Screen app and Safari keep separate storage.** Notes written in the Safari
  tab do not appear in the Home Screen app, and the other way round. Pick one and stay
  with it, or move between them with the backup file.
- **Safari clears unused site data after about a week.** If the trip has a long gap,
  tap *Download a backup of my notes* first. Opening the app resets the clock; the
  Home Screen app is not cleared this way.
- **Sharing** goes through the normal iOS share sheet, so the finished `.docx` can go
  to Mail, Files, Teams or AirDrop. If Safari declines to open the sheet the app shows
  a *Share it* button — tap it and the sheet opens.
- **Private Browsing** cannot save anything. The header pill says `not saving` when
  that is the case.

## What Create Mission produces

A `.docx` laid out the way the parser expects, so it can be loaded straight back in as
a template later:

```
Trip Report — Fort Bliss, TX          (Title)
Start location: HOR
Mission location: Fort Bliss, TX
Dates: 3 March 2026 – 7 March 2026
Next location: HOR
Number of soldiers trained: 42
Network SME (David Massey)            (Heading 1)
Day One (3 March 2026)                (Heading 2)
  what you typed for that day
Day Two (4 March 2026)
  ...
```

Both `HOR` fields are prefilled and editable. Roles come from a dropdown with an
**Other…** entry for anything not on the list. Up to 90 days.

## What it expects in an uploaded template

The parser keys off the text of the paragraphs:

- A person heading ends with a name in brackets — `Network SME (David Massey)`.
  Everything up to the next such heading belongs to that person.
- A day heading starts with `Day` and a number or a word — `Day One (3 March 2026)`,
  `Day 2`.
- A paragraph containing `soldiers trained` has its trailing number replaced by the
  count typed on the day screen.

On save, each day's existing prose is replaced by what is in the box, everyone else's
section is deleted, and the rest of the document — styles, headers, tables, images —
is passed through untouched.

## How it is put together

| File | What it is |
| --- | --- |
| `index.html` | The whole app: markup, styles, JSZip and the logic, in one file |
| `sw.js` | Service worker, caches the shell so the app opens offline |
| `manifest.webmanifest` | Home Screen name, icons, standalone display |
| `icon-*.png` | Icons, regenerate with `python3 tools/make-icons.py` |
| `.nojekyll` | Stops Pages running the files through Jekyll |

Storage is split: the notes go to `localStorage`, the template `.docx` goes to
IndexedDB. Safari caps `localStorage` near 5 MB, which a real template with images
would blow through — and when it does, the write fails and everything in it is lost.

## Working on it

```sh
python3 -m http.server 8777        # then open http://127.0.0.1:8777/
```

A plain file open works for a quick look, but service workers and storage need the
server. `127.0.0.1` counts as a secure origin, so the service worker registers there.

There is an end-to-end smoke test that drives the app in an iPhone-sized browser —
loads a template, writes notes, reloads, shares, downloads, goes offline:

```sh
npm i -D playwright && npx playwright install chromium
mkdir -p /tmp/trip && python3 tools/make-fixture.py /tmp/trip/trip_report.docx
python3 -m http.server 8777 &
WORK=/tmp/trip node tools/smoke-test.js      # the template path, sharing, offline
WORK=/tmp/trip node tools/keyboard-test.js   # the notes box vs. the keyboard
WORK=/tmp/trip node tools/mission-test.js    # Create Mission, and the .docx it writes
```

`mission-test.js` finishes by loading the generated `.docx` back in as a template, so a
break in either the writer or the parser shows up. To check the file against something
that is not our own code, `pip install python-docx` and open it — that validates the
package structure and styles independently.

It runs on Chromium, not Safari, so it is a regression net rather than proof about
iOS. What it does pin down is the part that silently breaks there: that
`navigator.share()` is called while the tap is still active. Real device checks still
belong on a phone.
