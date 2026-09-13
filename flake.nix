{
  description = "WFInfo headless OCR/theme core + Warframe Info dashboard — Linux development environment";

  # WFInfo is a Windows .NET Framework 4.8 WPF app. This flake supports the
  # platform-neutral core (OCR pipeline, theme detection, market-data layer and
  # the headless regression suite under headless/) running natively on Linux,
  # plus dashboard/ — a Deno + GOV.UK Frontend web dashboard over the local
  # WFInfo application data (logs, OCR runs, market databases).
  #
  #   nix develop            -> .NET 9 SDK, native tesseract/leptonica, Deno
  #   nix develop -c dotnet build headless/WFInfo.Headless.csproj
  #   nix develop -c dotnet run --project headless -- --selfcheck
  #   nix develop -c dotnet run --project headless -- --test tests/map.json out.json
  #   cd dashboard && deno task dev       -> dashboard on :8000 (inside nix develop)
  #   nix run .#dashboard                 -> dashboard app
  #   nix run .#dev-all                   -> dashboard live reload + scan-on-edit backend
  #   nix run .#tesseract-native          -> native-library farm path (usable in CI)

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];

      # Idiom (b): forAllSystems hands each consumer the imported pkgs set, so
      # consumers must name the parameter `pkgs` and must NOT re-import nixpkgs
      # (passing the pkgs set as `system` breaks evaluation).
      forAllSystems = f:
        nixpkgs.lib.genAttrs systems (system: f (nixpkgs.legacyPackages.${system}));

      # Native libraries for the Tesseract .NET wrapper and System.Drawing.
      #  - charlesw/tesseract dlopens exact sonames: libtesseract50.so +
      #    libleptonica-1.82.0.so (nixpkgs builds versioned libraries).
      #  - libgdiplus aliases below are a compatibility net: the project pins
      #    System.Drawing.Common 6.0.0 (plain libgdiplus via LD path), but some
      #    loaders probe Windows-style names (gdiplus.dll.so, ...).
      tesseractNative = pkgs: pkgs.runCommand "wfinfo-tesseract-native" { } ''
        mkdir -p $out/lib/x64 $out/lib/x86
        tess=$(find ${pkgs.tesseract5}/lib -maxdepth 1 -name 'libtesseract.so.*' | sort | tail -n1)
        lept=$(find ${pkgs.leptonica}/lib -maxdepth 1 -name 'libleptonica.so.*' | sort | tail -n1)
        [ -n "$tess" ] || { echo "libtesseract not found"; exit 1; }
        [ -n "$lept" ] || { echo "liblept not found"; exit 1; }
        ln -s "$tess" $out/lib/libtesseract50.so
        ln -s "$lept" $out/lib/libleptonica-1.82.0.so
        ln -s "$tess" $out/lib/x64/libtesseract50.so
        ln -s "$lept" $out/lib/x64/libleptonica-1.82.0.so
        ln -s "$tess" $out/lib/x86/libtesseract50.so
        ln -s "$lept" $out/lib/x86/libleptonica-1.82.0.so
        gd=$(find ${pkgs.libgdiplus}/lib -maxdepth 1 -name 'libgdiplus.so*' | sort | tail -n1)
        [ -n "$gd" ] || { echo "libgdiplus not found"; exit 1; }
        for alias in gdiplus.dll.so libgdiplus.dll.so gdiplus.dll libgdiplus.dll libgdiplus.so; do
          ln -s "$gd" $out/lib/$alias
        done
      '';

      # Environment the .NET OCR stack needs on Linux: the tesseract/leptonica
      # farm path, System.Drawing's libgdiplus plus its OpenSSL/ICU/zlib deps,
      # and fonts for GDI+ text rendering. Shared by the dev shell and `.#scan`.
      headlessRuntime = pkgs: {
        LD_LIBRARY_PATH = pkgs.lib.concatStringsSep ":" [
          "${tesseractNative pkgs}/lib"
          (pkgs.lib.makeLibraryPath [
            pkgs.libgdiplus
            pkgs.openssl
            pkgs.icu
            pkgs.zlib
            pkgs.fontconfig
          ])
        ];
        FONTCONFIG_FILE = pkgs.makeFontsConf { fontDirectories = [ pkgs.dejavu_fonts ]; };
        WFINFO_NATIVE_LIBS = "${tesseractNative pkgs}/lib";
      };

      # Binaries the scan path shells out to: capture (grim + output list),
      # the notification (notify-send) and the SDK that builds the runner.
      scanTools = pkgs: with pkgs; [ dotnet-sdk_9 grim wlr-randr libnotify ];

      # Tools the dashboard itself runs to list what a scan can capture: the
      # outputs (wlr-randr) and window names (wlrctl). Window *geometry* comes
      # from the running compositor's own client list (mmsg), which the
      # operator's session provides.
      dashboardTools = pkgs: with pkgs; [ deno wlr-randr wlrctl ];

      # The dev stack uses the scan tools plus the dashboard runtime (coreutils
      # carries the `sleep` the teardown uses).
      devTools = pkgs: (scanTools pkgs) ++ [ pkgs.deno pkgs.coreutils ];
    in
    {
      packages = forAllSystems (pkgs: {
        tesseract-native = tesseractNative pkgs;
        default = tesseractNative pkgs;
      });

      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages = with pkgs; [
            dotnet-sdk_9
            tesseract5
            leptonica
            libgdiplus
            fontconfig
            dejavu_fonts
            deno
            cacert
            grim
            wlr-randr
            wlrctl
            libnotify
          ];

          # .NET's runtime dlopens OpenSSL/ICU; libgdiplus needs its fonts.
          env = (headlessRuntime pkgs) // {
            DOTNET_CLI_TELEMETRY_OPTOUT = "1";
            DOTNET_NOLOGO = "1";
          };

          shellHook = ''
            echo "WFInfo headless dev shell"
            echo "  try: dotnet run --project headless -- --selfcheck"
            echo "  try: dotnet run --project headless -- --scan --no-notify   (reward-screen scan)"
            echo "  try: dotnet run --project headless -- --test tests/map.json out.json"
            echo "  try: cd dashboard && deno task dev   (Warframe Info dashboard on :8000)"
            echo "  try: nix run .#dev-all               (dashboard live reload + scan on backend edits)"
          '';
        };
      });

      # Offline gates so `nix flake check` runs without network: dashboard/src
      # never imports remote or package modules (unit tests use the local
      # zero-dependency testutil).
      checks = forAllSystems (pkgs:
        let
          gate = name: buildPhase: pkgs.stdenv.mkDerivation {
            name = "wfinfo-dashboard-${name}";
            src = self;
            buildInputs = [ pkgs.deno ];
            inherit buildPhase;
            installPhase = "mkdir -p $out";
          };
        in {
          dashboard-format = gate "format" ''
            cd dashboard && deno fmt --check
          '';
          dashboard-typecheck = gate "typecheck" ''
            cd dashboard && deno check src
          '';
          dashboard-unit-tests = gate "unit-tests" ''
            cd dashboard && deno test -A src
          '';
        });

      apps = forAllSystems (pkgs: {
        # Reward-screen scan: capture the screen, OCR it with the shared WFInfo
        # pipeline, price every part from the local price cache (warframe.market
        # fills it on demand), notify the best choice, and write a scan record
        # for the dashboard. Bind it to a key in the window manager:
        #
        #   None,Print,spawn_shell,nix run /path/to/WFinfo-ext#scan
        #
        # It runs the checkout at $PWD (override with WFINFO_SCAN_ROOT) because
        # the runner is built per checkout; the first press compiles it.
        scan = {
          type = "app";
          program =
            "${pkgs.writeShellScriptBin "wfscan" ''
              set -eu
              root="''${WFINFO_SCAN_ROOT:-$PWD}"
              if [ ! -f "$root/headless/WFInfo.Headless.csproj" ]; then
                echo "wfscan: no headless/WFInfo.Headless.csproj under $root" >&2
                echo "Run from the WFInfo-ext checkout, or set WFINFO_SCAN_ROOT." >&2
                exit 1
              fi
              export PATH="${pkgs.lib.makeBinPath (scanTools pkgs)}:''${PATH:-}"
${pkgs.lib.concatStringsSep "\n" (pkgs.lib.mapAttrsToList (name: value: "export ${name}=${pkgs.lib.escapeShellArg value}") (headlessRuntime pkgs))}
              cd "$root"
              dotnet build -c Release -v:q --nologo headless/WFInfo.Headless.csproj
              exec dotnet headless/bin/Release/net9.0/WFInfo.Headless.dll --scan "$@"
            ''}/bin/wfscan";
          meta.description = "Warframe Info reward-screen scan (OCR, prices, notification)";
        };

        # Automatic scanning: watch Warframe's EE.log and scan on every reward
        # screen, the Linux equivalent of the Windows app's "Auto" mode. The
        # engines and price cache are built once, so each triggered scan is one
        # capture plus the OCR. Start it with the session (mango):
        #
        #   exec,nix run /path/to/WFinfo-ext#scan-watch
        #
        # Extra arguments go to the scan, e.g. `-- --output DP-2`.
        scan-watch = {
          type = "app";
          program =
            "${pkgs.writeShellScriptBin "wfscan-watch" ''
              set -eu
              root="''${WFINFO_SCAN_ROOT:-$PWD}"
              if [ ! -f "$root/headless/WFInfo.Headless.csproj" ]; then
                echo "wfscan-watch: no headless/WFInfo.Headless.csproj under $root" >&2
                echo "Run from the WFinfo-ext checkout, or set WFINFO_SCAN_ROOT." >&2
                exit 1
              fi
              export PATH="${pkgs.lib.makeBinPath (scanTools pkgs)}:''${PATH:-}"
${pkgs.lib.concatStringsSep "\n" (pkgs.lib.mapAttrsToList (name: value: "export ${name}=${pkgs.lib.escapeShellArg value}") (headlessRuntime pkgs))}
              cd "$root"
              dotnet build -c Release -v:q --nologo headless/WFInfo.Headless.csproj
              # exec: the watch loop must receive SIGINT/SIGTERM itself, so the
              # window manager or the terminal stops it instead of this wrapper.
              exec dotnet headless/bin/Release/net9.0/WFInfo.Headless.dll --scan --watch "$@"
            ''}/bin/wfscan-watch";
          meta.description = "Warframe Info automatic reward-screen scan (EE.log watch)";
        };

        dashboard = {
          type = "app";
          program = "${pkgs.writeShellScriptBin "wfinfo-dashboard" ''
            export PATH="${pkgs.lib.makeBinPath (dashboardTools pkgs)}:''${PATH:-}"
            exec ${pkgs.deno}/bin/deno run -A ${self}/dashboard/src/main.ts "$@"
          ''}/bin/wfinfo-dashboard";
          meta.description = "Warframe Info dashboard (Deno + GOV.UK Frontend)";
        };

        # Full dev stack in one terminal: the dashboard frontend with live
        # reload, plus the headless backend rebuilt and re-run (reward-screen
        # scan) after every backend source edit. Ctrl-C stops both.
        #
        # The backend scan writes the same `<data dir>/WFInfo/scans/` record the
        # hotkey writes, so the dashboard's Scan page shows the current backend
        # output. Notifications stay off: one toast per edit is noise. Use
        # `nix run .#scan` for the notifying path.
        #
        # Extra arguments go to the scan:
        #   nix run .#dev-all -- --file docs/images/window.png
        #
        # The frontend takes the first free port from 8000 up unless PORT is
        # set: a service that already owns 8000 must not stop the whole stack.
        #
        # Both watchers must watch the working tree, so run it from the checkout
        # (override with WFINFO_DEV_ROOT).
        dev-all = {
          type = "app";
          program =
            "${pkgs.writeShellScriptBin "wfinfo-dev-all" ''
              set -eu
              root="''${WFINFO_DEV_ROOT:-$PWD}"
              if [ ! -f "$root/headless/WFInfo.Headless.csproj" ] || [ ! -f "$root/dashboard/src/main.ts" ]; then
                echo "wfinfo-dev-all: no headless/WFInfo.Headless.csproj or dashboard/src/main.ts under $root" >&2
                echo "Run from the WFInfo-ext checkout, or set WFINFO_DEV_ROOT." >&2
                exit 1
              fi
              export PATH="${pkgs.lib.makeBinPath (devTools pkgs)}:''${PATH:-}"
              export DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1
${pkgs.lib.concatStringsSep "\n" (pkgs.lib.mapAttrsToList (name: value: "export ${name}=${pkgs.lib.escapeShellArg value}") (headlessRuntime pkgs))}
              cd "$root"

              # The frontend port. An explicit PORT is taken as given; without
              # it the first free port from 8000 is used, so a service that
              # already owns 8000 (a container, another dev server) does not
              # stop the stack. Writes the result to PORT.
              port_in_use() {
                (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
              }
              if [ -n "''${PORT:-}" ]; then
                if port_in_use "$PORT"; then
                  echo "wfinfo-dev-all: PORT=$PORT is already in use" >&2
                  exit 1
                fi
              else
                PORT=8000
                while port_in_use "$PORT"; do
                  echo "wfinfo-dev-all: port $PORT is in use, trying $((PORT + 1))"
                  PORT=$((PORT + 1))
                  if [ "$PORT" -gt 8099 ]; then
                    echo "wfinfo-dev-all: no free port in 8000-8099; set PORT" >&2
                    exit 1
                  fi
                done
              fi
              export PORT

              pids=()
              # Job control puts each watcher in its own process group: `deno
              # --watch` and `dotnet watch` run the actual program in a child,
              # and killing only the watcher would leave that child alive and
              # holding the port. So teardown signals the whole group.
              set -m
              stop() {
                trap - INT TERM EXIT
                for pid in "''${pids[@]}"; do
                  kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
                done
                sleep 0.5
                for pid in "''${pids[@]}"; do
                  kill -KILL -- "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
                done
                wait 2>/dev/null || true
              }
              trap stop INT TERM EXIT

              echo "wfinfo-dev-all: backend  dotnet watch --scan (notifications off)"
              dotnet watch --project headless/WFInfo.Headless.csproj run -- --scan --no-notify "$@" &
              pids+=($!)

              echo "wfinfo-dev-all: frontend http://localhost:$PORT   (deno --watch)"
              deno run -A --watch dashboard/src/main.ts &
              pids+=($!)

              wait -n
            ''}/bin/wfinfo-dev-all";
          meta.description = "Warframe Info dev stack (dashboard live reload + headless scan on backend edits)";
        };
      });
    };
}
