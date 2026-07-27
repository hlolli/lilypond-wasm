#include <limits.h>
#include <stdio.h>
#include <string.h>

#include <fontconfig/fontconfig.h>
#include <pango/pango.h>
#include <pango/pangofc-font.h>
#include <pango/pangofc-fontmap.h>
#include <pango/pangoft2.h>

static int
fail (const char *message)
{
  fprintf (stderr, "pango smoke: %s\n", message);
  return 1;
}

static int
get_single_run (PangoLayout *layout, PangoLayoutLine **line_out,
                PangoGlyphItem **run_out)
{
  PangoLayoutLine *line;

  if (pango_layout_get_line_count (layout) != 1
      || pango_layout_get_unknown_glyphs_count (layout) != 0)
    return fail ("layout did not contain one complete line");

  line = pango_layout_get_line_readonly (layout, 0);
  if (line == NULL || line->runs == NULL || line->runs->next != NULL)
    return fail ("layout did not contain one glyph run");

  *line_out = line;
  *run_out = line->runs->data;
  return 0;
}

static int
check_glyph_run (PangoGlyphItem *run, int expected_glyphs)
{
  PangoRectangle logical;
  int i;

  if (run == NULL || run->item == NULL || run->glyphs == NULL
      || run->item->analysis.font == NULL
      || run->glyphs->num_glyphs != expected_glyphs)
    return fail ("glyph run had the wrong size or no font");

  for (i = 0; i < run->glyphs->num_glyphs; i++)
    {
      PangoGlyph glyph = run->glyphs->glyphs[i].glyph;

      if ((glyph & PANGO_GLYPH_UNKNOWN_FLAG) != 0
          || glyph == PANGO_GLYPH_INVALID_INPUT
          || glyph == PANGO_GLYPH_EMPTY)
        return fail ("glyph run contained an invalid glyph");
    }

  pango_glyph_string_extents (run->glyphs, run->item->analysis.font,
                              NULL, &logical);
  if (logical.width <= 0 || logical.height <= 0)
    return fail ("glyph run had empty logical extents");

  return 0;
}

static int
check_font_selection (PangoContext *context,
                      const PangoFontDescription *description,
                      const char *font_path)
{
  PangoFont *font;
  FcPattern *pattern;
  FcChar8 *selected_path = NULL;
  int result = 1;

  font = pango_context_load_font (context, description);
  if (font == NULL || !PANGO_IS_FC_FONT (font))
    return fail ("Pango did not load a Fontconfig-backed font");

  pattern = pango_fc_font_get_pattern (PANGO_FC_FONT (font));
  if (pattern == NULL
      || FcPatternGetString (pattern, FC_FILE, 0, &selected_path)
           != FcResultMatch
      || selected_path == NULL
      || strcmp ((const char *) selected_path, font_path) != 0)
    result = fail ("Pango selected a font outside the explicit config");
  else
    result = 0;

  g_object_unref (font);
  return result;
}

static int
check_latin (PangoContext *context,
             const PangoFontDescription *description)
{
  PangoLayout *layout;
  PangoLayoutLine *line;
  PangoGlyphItem *run;
  PangoAttrList *attributes;
  int result = 1;

  layout = pango_layout_new (context);
  pango_layout_set_font_description (layout, description);
  pango_layout_set_text (layout, "ffi", -1);

  if (get_single_run (layout, &line, &run) != 0
      || check_glyph_run (run, 1) != 0)
    goto done_default;

  g_object_unref (layout);

  layout = pango_layout_new (context);
  pango_layout_set_font_description (layout, description);
  pango_layout_set_text (layout, "ffi", -1);

  attributes = pango_attr_list_new ();
  pango_attr_list_insert (attributes, pango_attr_font_features_new ("liga=0"));
  pango_layout_set_attributes (layout, attributes);
  pango_attr_list_unref (attributes);

  if (get_single_run (layout, &line, &run) != 0
      || check_glyph_run (run, 3) != 0)
    goto done_default;

  result = 0;

done_default:
  g_object_unref (layout);
  return result;
}

static int
check_arabic (PangoContext *context,
              const PangoFontDescription *description)
{
  static const char text[] = "سلام";
  PangoLayout *layout;
  PangoLayoutLine *line;
  PangoGlyphItem *run;
  PangoGlyphItemIter iter;
  gboolean have_cluster;
  int cluster_count = 0;
  int first_index = INT_MAX;
  int last_index = 0;
  int result = 1;

  pango_context_set_language (context, pango_language_from_string ("ar"));
  pango_context_set_base_dir (context, PANGO_DIRECTION_RTL);

  layout = pango_layout_new (context);
  pango_layout_set_font_description (layout, description);
  pango_layout_set_auto_dir (layout, TRUE);
  pango_layout_set_text (layout, text, -1);

  if (get_single_run (layout, &line, &run) != 0
      || check_glyph_run (run, 3) != 0)
    goto done;

  if (pango_layout_get_direction (layout, 0) != PANGO_DIRECTION_RTL
      || pango_layout_line_get_resolved_direction (line) != PANGO_DIRECTION_RTL
      || (run->item->analysis.level & 1) == 0
      || run->item->analysis.script != PANGO_SCRIPT_ARABIC
      || run->item->num_chars != 4)
    {
      fail ("Arabic direction or script analysis was wrong");
      goto done;
    }

  if (run->glyphs->log_clusters[0]
      <= run->glyphs->log_clusters[run->glyphs->num_glyphs - 1])
    {
      fail ("Arabic glyph clusters were not in RTL order");
      goto done;
    }

  for (have_cluster = pango_glyph_item_iter_init_start (&iter, run, text);
       have_cluster;
       have_cluster = pango_glyph_item_iter_next_cluster (&iter))
    {
      cluster_count++;
      if (iter.start_index < first_index)
        first_index = iter.start_index;
      if (iter.end_index > last_index)
        last_index = iter.end_index;
    }

  if (cluster_count != 3
      || first_index != 0
      || last_index != (int) strlen (text))
    {
      fail ("Arabic cluster iteration did not cover the full text");
      goto done;
    }

  result = 0;

done:
  g_object_unref (layout);
  return result;
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
    "      <string>DejaVu Sans</string>"
    "    </edit>"
    "  </match>"
    "</fontconfig>";
  FcConfig *config;
  PangoFontMap *font_map;
  PangoContext *context;
  PangoFontDescription *description;
  int result = 1;

  if (argc != 2)
    return fail ("expected one preopened font path");

  config = FcConfigCreate ();
  if (config == NULL)
    return fail ("could not create a Fontconfig config");

  if (!FcConfigParseAndLoadFromMemory (config, config_xml, FcTrue)
      || !FcConfigAppFontAddFile (config, (const FcChar8 *) argv[1]))
    {
      FcConfigDestroy (config);
      return fail ("could not load the explicit Fontconfig data");
    }

  if (!FcConfigSetCurrent (config))
    {
      FcConfigDestroy (config);
      return fail ("could not make the explicit Fontconfig data current");
    }

  font_map = pango_ft2_font_map_new ();
  pango_ft2_font_map_set_resolution (PANGO_FT2_FONT_MAP (font_map), 72.0, 72.0);
  pango_fc_font_map_set_config (PANGO_FC_FONT_MAP (font_map), config);
  FcConfigDestroy (config);

  context = pango_font_map_create_context (font_map);
  description = pango_font_description_new ();
  pango_font_description_set_family (description, "WASI Alias");
  pango_font_description_set_size (description, 16 * PANGO_SCALE);

  if (check_font_selection (context, description, argv[1]) != 0
      || check_latin (context, description) != 0
      || check_arabic (context, description) != 0)
    goto done;

  printf (
    "pango %s: font selection, Latin features and Arabic layout passed\n",
    pango_version_string ());
  result = 0;

done:
  pango_font_description_free (description);
  g_object_unref (context);
  g_object_unref (font_map);
  FcConfigSetCurrent (NULL);
  return result;
}
