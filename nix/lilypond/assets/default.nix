{
  dejavu_fonts,
  fetchFromGitHub,
  fontforge,
  lib,
  perl,
  python3,
  src,
  stdenvNoCC,
  t1utils,
  texlive,
}: let
  kpathseaBin = texlive.pkgs.kpathsea.out;
  kpathseaData = texlive.pkgs.kpathsea.tex;
  metapostBin = texlive.pkgs.metapost.out;
  metapostData = texlive.pkgs.metapost.tex;

  urwBase35Version = "20200910";
  urwBase35 = fetchFromGitHub {
    name = "lilypond-urw-base35-fonts";
    owner = "ArtifexSoftware";
    repo = "urw-base35-fonts";
    tag = urwBase35Version;
    hash = "sha256-YQl5IDtodcbTV3D6vtJi7CwxVtHHl58fG6qCAoSaP4U=";
  };
in
  stdenvNoCC.mkDerivation (finalAttrs: {
    pname = "lilypond-assets";
    version = "2.27.2";

    inherit src;

    patches = [
      ./patches/0001-use-bundled-svg-text-fonts.patch
    ];

    strictDeps = true;

    nativeBuildInputs = [
      fontforge
      kpathseaBin
      metapostBin
      perl
      python3
      t1utils
    ];

    dontConfigure = true;

    enableParallelBuilding = true;

    buildPhase = ''
      runHook preBuild

      export TEXMFCNF="${kpathseaData}/web2c"
      export TEXMF="{${metapostData},${kpathseaData}}"

      # These targets need only host tools and do not run LilyPond.
      env -u out make -C scm default \
        config=/dev/null \
        configure-srcdir=. \
        PYTHON="${python3}/bin/python3"
      env -u out make -C mf default \
        config=/dev/null \
        configure-srcdir=. \
        FONTFORGE="${fontforge}/bin/fontforge" \
        PERL="${perl}/bin/perl" \
        PYTHON="${python3}/bin/python3"

      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall

      data_dir="$out/share/lilypond/${finalAttrs.version}"
      mkdir -p \
        "$data_dir/ly" \
        "$data_dir/scm/lily" \
        "$data_dir/fonts/otf" \
        "$data_dir/fonts/svg" \
        "$data_dir/fonts/text"

      cp ly/*.ly "$data_dir/ly/"
      cp scm/*.scm scm/out/font-encodings.scm "$data_dir/scm/lily/"
      cp mf/*.conf "$data_dir/fonts/"
      cp ${./fonts.conf} "$data_dir/fonts/fonts.conf"
      cp mf/out/emmentaler-*.otf "$data_dir/fonts/otf/"
      cp mf/out/emmentaler-*.svg "$data_dir/fonts/svg/"

      cp \
        ${urwBase35}/fonts/C059-*.otf \
        ${urwBase35}/fonts/NimbusMonoPS-*.otf \
        ${urwBase35}/fonts/NimbusSans-*.otf \
        "$data_dir/fonts/text/"

      cp \
        ${dejavu_fonts}/share/fonts/truetype/DejaVuSerif.ttf \
        ${dejavu_fonts}/share/fonts/truetype/DejaVuSerif-{Bold,BoldItalic,Italic}.ttf \
        ${dejavu_fonts}/share/fonts/truetype/DejaVuSans.ttf \
        ${dejavu_fonts}/share/fonts/truetype/DejaVuSans-{Bold,BoldOblique,Oblique}.ttf \
        ${dejavu_fonts}/share/fonts/truetype/DejaVuSansMono.ttf \
        ${dejavu_fonts}/share/fonts/truetype/DejaVuSansMono-{Bold,BoldOblique,Oblique}.ttf \
        "$data_dir/fonts/text/"

      license_dir="$out/share/licenses/lilypond-assets"
      mkdir -p "$license_dir"
      cp \
        COPYING \
        COPYING.FDL \
        LICENSE \
        LICENSE.DOCUMENTATION \
        LICENSE.OFL \
        "$license_dir/"
      cp ${urwBase35}/COPYING "$license_dir/URW-Base35-COPYING"
      cp ${urwBase35}/LICENSE "$license_dir/URW-Base35-LICENSE"
      cp ${dejavu_fonts.full-ttf.src}/LICENSE "$license_dir/DejaVu-LICENSE"

      test -s "$data_dir/scm/lily/font-encodings.scm"
      test -s "$data_dir/fonts/otf/emmentaler-20.otf"
      test -s "$data_dir/fonts/svg/emmentaler-20.svg"
      test -s "$data_dir/fonts/text/C059-Roman.otf"
      test -s "$data_dir/fonts/text/DejaVuSerif.ttf"
      test "$(find "$data_dir/fonts/otf" -type f | wc -l)" -eq 9
      test "$(find "$data_dir/fonts/svg" -type f | wc -l)" -eq 9
      test "$(find "$data_dir/fonts/text" -type f | wc -l)" -eq 24
      test -s "$license_dir/URW-Base35-LICENSE"
      test -s "$license_dir/DejaVu-LICENSE"

      runHook postInstall
    '';

    doCheck = false;
    doInstallCheck = false;

    passthru.sourceInputs = {
      dejavu = {
        source = dejavu_fonts.full-ttf.src;
        version = dejavu_fonts.full-ttf.version;
      };
      urw-base35 = {
        source = urwBase35;
        version = urwBase35Version;
      };
    };

    meta = {
      description = "Pinned LilyPond runtime data and fonts";
      homepage = "https://lilypond.org/";
      license = with lib.licenses; [
        agpl3Plus
        free
        gpl3Plus
        ofl
      ];
      platforms = lib.platforms.all;
    };
  })
