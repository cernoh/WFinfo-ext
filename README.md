# WFInfo — Linux and Nix development

WFInfo is a Windows desktop app. The platform-neutral core of WFInfo (OCR
pipeline, theme detection, market data, regression tests) also builds and runs
natively on Linux through the Nix flake in this repository. No code forks and no
mocks: the Linux runner executes the production pipelines.

## Development shell

The flake needs Nix with flakes enabled.

```bash
git clone git@github.com:cernoh/WFinfo-ext.git
cd WFinfo-ext
nix develop
```

The shell has the .NET 9 SDK, the native Tesseract and Leptonica libraries,
`libgdiplus`, DejaVu fonts, and Deno. It also sets the environment variables that
the .NET OCR stack reads on Linux.

## Headless OCR and theme runner

`headless/` is a .NET 9 console runner. It links the real WFInfo core sources
and runs them without WPF, WinForms, or Win32.

```bash
nix develop
dotnet build headless/WFInfo.Headless.csproj
dotnet run --project headless -- --selfcheck
dotnet run --project headless -- --test tests/map.json out.json
dotnet run --project headless -- --theme-test <folder-with-pngs>
```

`--selfcheck` renders sample text and OCRs it. It proves that the native
libraries, the tessdata files, and the imaging path all work.

Every `--test` run also writes its results to `<data dir>/WFInfo/ocr_runs/`.

## Reward-screen scan

`--scan` reads the screen, runs the production OCR pipeline over the reward
strip, prices each part, and reports the best platinum choice.

```bash
nix run .#scan                     # capture the screen, notify, write a record
nix run .#scan -- --refresh        # ignore the price-cache lifetime
nix run .#scan -- --file shot.png  # price an existing screenshot
nix run .#scan -- --output DP-2    # capture one monitor
nix run .#scan -- --region "10,44 1900x1026"  # capture one window's frame
nix run .#scan -- --json           # print the scan record to stdout
```

Each run does this:

1. Captures the screen with `grim` for each Wayland output, unless `--file`,
   `--region`, or `--output` pins one image.

2. OCRs the reward strip and corrects each name against `market_items.json`.

3. Prices each part from the local cache. Missing or stale prices come from the
   warframe.market statistics endpoint in parallel. The market sheet is the
   offline fallback, so a network fault does not stop the scan.

4. Shows the best platinum choice in a desktop notification.

5. Writes the record to `<data dir>/WFInfo/scans/latest.json`.

Bind the scan to a key in your window manager. Example for mango or dwl:

```
None,Print,spawn_shell,nix run /path/to/WFinfo-ext#scan
```

The complete option list and the record schema are in `headless/README.md`.

## Warframe Info dashboard

`dashboard/` is a Deno web server. It shows the WFInfo logs, the OCR runs, the
cached market prices, and the newest scan in a browser. The pages use the GOV.UK
Design System.

```bash
nix run .#dashboard           # dashboard on http://localhost:8000 (store copy)
nix run .#dev                 # live-reload server (working tree)
cd dashboard && deno task dev # live-reload server inside `nix develop`
```

### Frontend and backend together

`nix run .#dev-all` runs the dashboard with live reload and the headless backend
in one terminal. The backend rebuilds and runs a reward-screen scan again after
every edit under `headless/`, so the Scan page shows the new result. Press
Ctrl-C to stop both.

```bash
nix run .#dev-all                              # dashboard + scan-on-edit backend
nix run .#dev-all -- --file docs/images/window.png # extra arguments go to the scan
```

The dev stack turns notifications off, because one notification per edit is
noise. Use `nix run .#scan` for the notifying path.

The dev stack prints the dashboard address it chose. It takes the first free
port from 8000 up, so a service that already holds 8000 does not stop it. Set
`PORT` to pin the port; a busy `PORT` is then a start error.

The dashboard reads the WFInfo data directory and never writes to it. On Linux
the data directory is `~/.config/WFInfo`.

### Choose the captured display or window

The Scan page lists the displays and the windows of the machine that runs the
dashboard. Choose the display that shows Warframe, or choose one window to
capture its frame instead of the whole monitor. Press "Refresh lists" after
Warframe starts, then press "Scan now".

## Checks

```bash
nix flake check              # format, typecheck, and unit tests in a sandbox
nix build .#tesseract-native # native-library output, for use in CI
```

## Environment

- `WFINFO_DATA_DIR` — application-data root. The default is the XDG config
  directory.
- `WFINFO_NATIVE_LIBS` — directory that holds `libtesseract50.so` and
  `libleptonica-1.82.0.so`. The dev shell sets this.

See `headless/README.md` and `dashboard/README.md` for the full details.

---

# Original WFInfo README

[![Supported by the Warframe Community Developers](https://img.shields.io/badge/Warframe_Comm_Devs-supported-blue.svg?color=2E96EF&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyOTgiIGhlaWdodD0iMTczIiB2aWV3Qm94PSIwIDAgMjk4IDE3MyI%2BPHBhdGggZD0iTTE4NSA2N2MxNSA4IDI4IDE2IDMxIDE5czIzIDE4LTcgNjBjMCAwIDM1LTMxIDI2LTc5LTE0LTctNjItMzYtNzAtNDUtNC01LTEwLTEyLTE1LTIyLTUgMTAtOSAxNC0xNSAyMi0xMyAxMy01OCAzOC03MiA0NS05IDQ4IDI2IDc5IDI2IDc5LTMwLTQyLTEwLTU3LTctNjBsMzEtMTkgMzYtMjIgMzYgMjJ6TTU1IDE3M2wtMTctM2MtOC0xOS0yMC00NC0yNC01MC01LTctNy0xMS0xNC0xNWwxOC0yYzE2LTMgMjItNyAzMi0xMyAxIDYgMCA5IDIgMTQtNiA0LTIxIDEwLTI0IDE2IDMgMTQgNSAyNyAyNyA1M3ptMTYtMTFsLTktMi0xNC0yOWEzMCAzMCAwIDAgMC04LThoN2wxMy00IDQgN2MtMyAyLTcgMy04IDZhODYgODYgMCAwIDAgMTUgMzB6bTE3MiAxMWwxNy0zYzgtMTkgMjAtNDQgMjQtNTAgNS03IDctMTEgMTQtMTVsLTE4LTJjLTE2LTMtMjItNy0zMi0xMy0xIDYgMCA5LTIgMTQgNiA0IDIxIDEwIDI0IDE2LTMgMTQtNSAyNy0yNyA1M3ptLTE2LTExbDktMiAxNC0yOWEzMCAzMCAwIDAgMSA4LThoLTdsLTEzLTQtNCA3YzMgMiA3IDMgOCA2YTg2IDg2IDAgMCAxLTE1IDMwem0tNzktNDBsLTYtNmMtMSAzLTMgNi02IDdsNSA1YTUgNSAwIDAgMSAyIDB6bS0xMy0yYTQgNCAwIDAgMSAxLTJsMi0yYTQgNCAwIDAgMSAyLTFsNC0xNy0xNy0xMC04IDcgMTMgOC0yIDctNyAyLTgtMTItOCA4IDEwIDE3em0xMiAxMWE1IDUgMCAwIDAtNC0yIDQgNCAwIDAgMC0zIDFsLTMwIDI3YTUgNSAwIDAgMCAwIDdsNCA0YTYgNiAwIDAgMCA0IDIgNSA1IDAgMCAwIDMtMWwyNy0zMWMyLTIgMS01LTEtN3ptMzkgMjZsLTMwLTI4LTYgNmE1IDUgMCAwIDEgMCAzbDI2IDI5YTEgMSAwIDAgMCAxIDBsNS0yIDItMmMxLTIgMy01IDItNnptNS00NWEyIDIgMCAwIDAtNCAwbC0xIDEtMi00YzEtMy01LTktNS05LTEzLTE0LTIzLTE0LTI3LTEzLTIgMS0yIDEgMCAyIDE0IDIgMTUgMTAgMTMgMTNhNCA0IDAgMCAwLTEgMyAzIDMgMCAwIDAgMSAxbC0yMSAyMmE3IDcgMCAwIDEgNCAyIDggOCAwIDAgMSAyIDNsMjAtMjFhNyA3IDAgMCAwIDEgMSA0IDQgMCAwIDAgNCAwYzEtMSA2IDMgNyA0aC0xYTMgMyAwIDAgMCAwIDQgMiAyIDAgMCAwIDQgMGw2LTZhMyAzIDAgMCAwIDAtM3oiIGZpbGw9IiMyZTk2ZWYiIGZpbGwtcnVsZT0iZXZlbm9kZCIvPjwvc3ZnPg%3D%3D)](https://github.com/WFCD/banner/blob/master/PROJECTS.md)

# Description


WFInfo is a companion app for Warframe, based on the [original](https://github.com/Schwaxx/WFInfo) which is no being longer developed. 
WFinfo is designed to provide quick access to both Platinum and Ducat prices for all fissure rewards to make selecting the best reward easy.

WFInfo does this by screenshotting the game window, cropping out the part text, then passing it to an Optical Character Recognition Engine, specifically Google's Tesseract. The OCR Engine will then send back the text it found, and we will pull out the part name from that text. From there, we display the stats for each part in an overlay or on a separate window.

# Usage
1. Download the [latest release](https://github.com/WFCD/WFinfo/releases/latest)
1. WFinfo requires some aditional software to function properly:
   1. Download BOTH Microsoft Visual C++ Redistributable 2019 from Microsoft [x64](https://aka.ms/vs/16/release/VC_redist.x64.exe) and [x86](https://aka.ms/vs/16/release/VC_redist.x86.exe). Make sure you have BOTH installed or it will not work.
   1. For Windows 7 users: [Enable TLS in registry](https://docs.microsoft.com/en-us/windows-server/security/tls/tls-registry-settings) and ensure you have installed [.NET Framework Runtime 4.8](https://dotnet.microsoft.com/download/dotnet-framework/thank-you/net48-web-installer)
1. Run WFInfo.exe and wait for it to complete the initial load (databases + OCR data)
1. Go into warframe game and set the displaymode to `Borderless Fullscreen` and under interface turn `Item Lables` on.
1. Press the hotkey `print screen` on a fissure reward screen to show the display, or simply wait if you use the auto feature
1. When the program does not seem to function, do not spam the hotkey. This will create un-nessesary noise that will make debugging more difficult

# Will I get Banned?

DE[Aidan] has confirmed in a forum post that this will not ban you. 

[![Image of post](https://i.imgur.com/ZGD8ISp.jpg)](https://forums.warframe.com/topic/875096-wfinfo-in-game-ducats-and-platinum-prices/?do=findComment&comment=9176107)

Reference:

https://forums.warframe.com/topic/875096-wfinfo-in-game-ducats-and-platinum-prices/?do=findComment&comment=9176107

(However, he is now retired member, and no longer part of DE)

# Features

### Expansive Part Information

![Overlays](https://wfinfo.warframestat.us/images/Github/Overlays.PNG)

![Reward Window](https://wfinfo.warframestat.us/images/Github/RewardWindow.PNG)

When WFInfo displays the part information, through an overlay or a separate window, a large selection of data is displayed. 

Here's a quick highlight of the information shown:

- Owned count (based on the Equipment Window)
- Vaulted tag (shows up if the part is vaulted)
- Part name (use this to confirm no errors occured)
- Plat Value (based on average prices on warframe.market)
- Ducat Value
- Volume Sold (amount of parts sold in the last 48 hours on warframe.market)

### Various Conveniences

![Settings Window](https://wfinfo.warframestat.us/images/Github/Settings.PNG)

* Auto Mode
  * When enabled, this will listen to the debug log (EE.log) and wait for a message to appear saying that the rewards are displayed. Currently, it is "Got rewards". Once it sees that message, it will trigger the display function and bring up your overlay/window with the reward info.
  * If it can't detect the reward screen within 5 seconds, then it will assume an error happened.
    * If it doesn't display, you can just hit the key and force it to activate.

![Clipboard](https://wfinfo.warframestat.us/images/Github/Clipboard.PNG)

* Clipboard Copy
  * When enabled, WFInfo will copy the plat prices and the part names into the clipboard so you can just paste them into Warframe's Chat for your party-mates.
  * This does attempt to link the parts themselves so that it's easier to see.
  
![AutoUpdate](https://i.imgur.com/jnk0nXA.png)

* Auto Update!
  * During the initial load of WFInfo, it will query our site to check for any updates available.
  * If any are found, it will display the prompt above and you can let it download and update WFInfo for you!
  * We're currently working on slimming the download file down, so you don't have to worry about a massive download with every update. Current estimates are in the range of 15MB.

### Relic Panel

![Relic Panel](https://wfinfo.warframestat.us/images/Github/Relics_Basic.PNG)

The Relics panel allows you to look at all relics and see statistics for each. We show basic info such as whether a relic is vaulted and the relic's rewards and the rarities of those rewards, and we have three complex statistics for every relic:
1. The average platinum price of an Intact relic's rewards, which are based on drop chance.
1. The average platinum price of a Radiant relic's rewards, which are as well.
1. The difference between the two above values, which can be used to find which relics will give you more plat, on average, when refined.

### Equipment Panel

![Equipment Panel](https://wfinfo.warframestat.us/images/Github/Eqmt_Addition.PNG)

The Equipment window allows you to look at each prime equipment and its parts. It shows how much each costs currently on warframe.market, and also shows how much it will cost to purchase a whole set of equipment. 

If you mark an item here, it will show up during a fissure reward screen.

##### Note: For both of these info panels, there are several sorting options that allow you to find what is best for you. Also they have grouping features that allow you to see and sort all relics, or to only sort from one era, i.e. Lith.

### Snap-it

When looking at your Prime inventory, you can scan it to see how many plats, ducats or even plats/ducats is worth each items, really usefull for baro's ducats, or just take a quick look at what items you can sell on WFM.
The scanned items list can even be exported to a CSV file, allowing you to see them from a different angle and maths.
  
### Warframe.Market connectivity

Manage your Warframe.Market online status automatically by detecting if your game is running or by detecting your AFK status.
Search for specific items on the go with the press of 2 keys, you even can add them to your listings without quitting your game.
List your choosen prime rewards at the end of your mission by clicking the "Confirm Listing" buttons, even for multiple items.
If you really like this software, you even can post a review on the devs profile by the press of one button !

# Credits/Contact:

**Kekasi:** u/RandomFacades (Reddit), Kekasi (Warframe), Kek#5390 (Discord)

**Dapal-003:** u/Dapal-003 (Reddit), Dapal003 (Warframe), ダパール・Dapal-003#0695 (Discord)

**Dimon222:** u/dimon222 (Reddit), dimon222 (Warframe), dimon222#8256 (Discord)

**Discord:** https://discord.gg/qfd3eFb

**Website:** https://wfinfo.warframestat.us/
