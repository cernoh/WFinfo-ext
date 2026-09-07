{
  description = "WFInfo headless OCR/theme core — native Linux development environment";

  # WFInfo is a Windows .NET Framework 4.8 WPF app. This flake supports the
  # platform-neutral core (OCR pipeline, theme detection, market-data layer and
  # the headless regression suite under headless/) running natively on Linux.
  #
  #   nix develop            -> .NET 9 SDK, libgdiplus, native tesseract/leptonica,
  #                             fonts and the WFINFO_NATIVE_LIBS env wiring
  #   nix develop -c dotnet build headless/WFInfo.Headless.csproj
  #   nix develop -c dotnet run --project headless -- --selfcheck
  #   nix develop -c dotnet run --project headless -- --test tests/map.json out.json
  #   nix run .#tesseract-native   -> native-library farm path (usable in CI)

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];

      # Note: access pkgs through legacyPackages.<system>; `import nixpkgs { inherit system; }`
      # does not evaluate in this environment.
      forAllSystems = f:
        nixpkgs.lib.genAttrs systems (system: f (nixpkgs.legacyPackages.${system}));

      # Native libraries for the Tesseract .NET wrapper and System.Drawing.
      #  - charlesw/tesseract dlopens exact sonames: libtesseract50.so +
      #    libleptonica-1.82.0.so (nixpkgs builds versioned libraries).
      #  - System.Drawing.Common 9 on Unix probes Windows-ish names
      #    (gdiplus.dll.so, libgdiplus.dll.so, ...) before failing.
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
          '';
        };
      });
    };
}
