#include <fontconfig/fontconfig.h>
#include <fontconfig/fcfreetype.h>

#include <stdio.h>
#include <string.h>

static int
fail (const char *message)
{
    fprintf (stderr, "fontconfig smoke: %s\n", message);
    return 1;
}

int
main (int argc, char **argv)
{
    static const FcChar8 config_xml[] =
	"<fontconfig>"
	"  <match target=\"pattern\">"
	"    <test name=\"family\" compare=\"eq\">"
	"      <string>WASI Alias</string>"
	"    </test>"
	"    <edit name=\"family\" mode=\"assign\">"
	"      <string>TeX Gyre Cursor</string>"
	"    </edit>"
	"  </match>"
	"</fontconfig>";
    FcConfig  *config;
    FcPattern *scanned;
    FcPattern *query;
    FcPattern *match;
    FcChar8   *family;
    FcChar8   *file;
    FcCharSet *charset;
    FcResult   result;
    int        count = 0;
    int        status = 1;

    if (argc != 2)
	return fail ("expected one font path");

    config = FcConfigCreate();
    if (!config)
	return fail ("could not create a config");

    if (!FcConfigParseAndLoadFromMemory (config, config_xml, FcTrue)) {
	fail ("could not parse the in-memory config");
	goto destroy_config;
    }

    scanned = FcFreeTypeQuery ((const FcChar8 *)argv[1], 0, NULL, &count);
    if (!scanned || count < 1) {
	fail ("FreeType could not scan the font");
	goto destroy_scanned;
    }
    if (FcPatternGetCharSet (scanned, FC_CHARSET, 0, &charset) != FcResultMatch ||
        !FcCharSetHasChar (charset, (FcChar32)'A')) {
	fail ("the scanned font lacks its expected character set");
	goto destroy_scanned;
    }

    if (!FcConfigAppFontAddFile (config, (const FcChar8 *)argv[1])) {
	fail ("could not add the application font");
	goto destroy_scanned;
    }

    query = FcPatternCreate();
    if (!query ||
        !FcPatternAddString (query, FC_FAMILY, (const FcChar8 *)"WASI Alias")) {
	fail ("could not create a query");
	goto destroy_query;
    }
    if (!FcConfigSubstitute (config, query, FcMatchPattern)) {
	fail ("could not apply the in-memory config");
	goto destroy_query;
    }
    if (FcPatternGetString (query, FC_FAMILY, 0, &family) != FcResultMatch ||
        strcmp ((const char *)family, "TeX Gyre Cursor") != 0) {
	fail ("the family alias was not applied");
	goto destroy_query;
    }

    FcConfigSetDefaultSubstitute (config, query);
    match = FcFontMatch (config, query, &result);
    if (!match || result != FcResultMatch) {
	fail ("could not match the application font");
	goto destroy_match;
    }
    if (FcPatternGetString (match, FC_FILE, 0, &file) != FcResultMatch ||
        strcmp ((const char *)file, argv[1]) != 0) {
	fail ("the matched font path is wrong");
	goto destroy_match;
    }

    printf ("fontconfig %d.%d.%d: config, scan and match checks passed\n",
            FC_MAJOR, FC_MINOR, FC_REVISION);
    status = 0;

destroy_match:
    if (match)
	FcPatternDestroy (match);
destroy_query:
    if (query)
	FcPatternDestroy (query);
destroy_scanned:
    if (scanned)
	FcPatternDestroy (scanned);
destroy_config:
    FcConfigDestroy (config);
    return status;
}
