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
  #   nix run .#dev                       -> dashboard dev server, live reload (:8000)
  #   nix run .#dashboard                 -> dashboard app
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
          ];

          # .NET's runtime dlopens OpenSSL/ICU; libgdiplus needs its fonts.
          env = {
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
            DOTNET_CLI_TELEMETRY_OPTOUT = "1";
            DOTNET_NOLOGO = "1";
          };

          shellHook = ''
            echo "WFInfo headless dev shell"
            echo "  try: dotnet run --project headless -- --selfcheck"
            echo "  try: dotnet run --project headless -- --test tests/map.json out.json"
            echo "  try: nix run .#dev                   (dashboard live-reload server on :8000)"
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
        # Live-reload development server: deno.json's `dev` task runs the
        # server with `--watch`, so a source edit restarts it.
        #
        # Unlike `.#dashboard`, this must run the working tree: Nix copies the
        # flake source into the read-only store, where `--watch` can never see
        # an edit. So resolve the dashboard from the current directory.
        dev = {
          type = "app";
          # `program` must name the script, not the derivation output dir.
          program =
            "${pkgs.writeShellScriptBin "wfinfo-dashboard-dev" ''
              set -eu
              PATH="${pkgs.deno}/bin''${PATH:+:$PATH}"
              export PATH
              root="''${WFINFO_DASHBOARD_ROOT:-$PWD}"
              if [ ! -f "$root/dashboard/src/main.ts" ]; then
                echo "wfinfo-dashboard-dev: no dashboard/src/main.ts under $root" >&2
                echo "Run from the repository root, or set WFINFO_DASHBOARD_ROOT." >&2
                exit 1
              fi
              cd "$root/dashboard"
              exec deno task dev "$@"
            ''}/bin/wfinfo-dashboard-dev";
          meta.description = "Warframe Info dashboard dev server (live reload, working tree)";
        };

        dashboard = {
          type = "app";
          program =
            "${pkgs.writeShellScriptBin "wfinfo-dashboard" ''
              exec ${pkgs.deno}/bin/deno run -A ${self}/dashboard/src/main.ts "$@"
            ''}/bin/wfinfo-dashboard";
          meta.description = "Warframe Info dashboard server (flake source copy)";
        };
      });
    };
}
