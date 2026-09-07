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
            echo "  try: cd dashboard && deno task dev   (Warframe Info dashboard on :8000)"
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
        dashboard = {
          type = "app";
          program = toString (pkgs.writeShellScriptBin "wfinfo-dashboard" ''
            exec ${pkgs.deno}/bin/deno run -A ${self}/dashboard/src/main.ts "$@"
          '');
        };
      });
    };
}
