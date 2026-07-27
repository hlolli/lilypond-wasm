#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include <ft2build.h>
#include FT_FREETYPE_H

#include <hb-ft.h>
#include <hb.h>

static int
fail (const char *message)
{
  fprintf (stderr, "%s\n", message);
  return 1;
}

static int
fail_freetype (const char *step, FT_Error error)
{
  fprintf (stderr, "%s failed with FreeType error 0x%02x\n", step, error);
  return 1;
}

static int
check_file_blob (const char *font_path)
{
  const char *data;
  unsigned int data_length;
  unsigned int blob_length;
  hb_blob_t *blob;
  hb_face_t *face;

  blob = hb_blob_create_from_file (font_path);
  blob_length = hb_blob_get_length (blob);
  data = hb_blob_get_data (blob, &data_length);

  if (data == NULL || blob_length < 100000 || data_length != blob_length)
    {
      hb_blob_destroy (blob);
      return fail ("the file-backed HarfBuzz blob was empty");
    }

  face = hb_face_create (blob, 0);
  if (hb_face_get_upem (face) != 2048
      || hb_face_get_glyph_count (face) < 5000)
    {
      hb_face_destroy (face);
      hb_blob_destroy (blob);
      return fail ("the file-backed HarfBuzz face metadata did not match");
    }

  hb_face_destroy (face);
  hb_blob_destroy (blob);
  return 0;
}

static int
check_shape (hb_font_t *font, const char *text,
             hb_direction_t expected_direction, const hb_feature_t *features,
             unsigned int feature_count, unsigned int expected_glyph_count,
             const char *failure_message)
{
  hb_buffer_t *buffer;
  hb_glyph_info_t *glyphs;
  hb_glyph_position_t *positions;
  unsigned int glyph_count;
  int64_t total_advance = 0;
  unsigned int i;

  buffer = hb_buffer_create ();
  hb_buffer_add_utf8 (buffer, text, -1, 0, -1);
  hb_buffer_guess_segment_properties (buffer);

  if (hb_buffer_get_direction (buffer) != expected_direction)
    {
      hb_buffer_destroy (buffer);
      return fail ("HarfBuzz guessed the wrong text direction");
    }

  hb_shape (font, buffer, features, feature_count);

  glyphs = hb_buffer_get_glyph_infos (buffer, &glyph_count);
  positions = hb_buffer_get_glyph_positions (buffer, NULL);
  if (glyph_count != expected_glyph_count || glyphs == NULL
      || positions == NULL)
    {
      hb_buffer_destroy (buffer);
      return fail (failure_message);
    }

  for (i = 0; i < glyph_count; i++)
    {
      if (glyphs[i].codepoint == 0)
        {
          hb_buffer_destroy (buffer);
          return fail ("shaping returned a missing glyph");
        }
      total_advance += positions[i].x_advance;
    }

  hb_buffer_destroy (buffer);

  if (total_advance <= 0)
    return fail ("shaping returned no horizontal advance");

  return 0;
}

int
main (int argc, char **argv)
{
  FT_Library library;
  FT_Face face;
  FT_Error error;
  hb_codepoint_t glyph;
  hb_feature_t disable_ligatures;
  hb_font_t *font;
  hb_position_t advance;
  int x_scale;
  int y_scale;

  if (argc != 2)
    return fail ("expected one preopened font path");

  if (strcmp (hb_version_string (), HB_VERSION_STRING) != 0)
    return fail ("the HarfBuzz runtime and headers have different versions");

  if (check_file_blob (argv[1]) != 0)
    return 1;

  error = FT_Init_FreeType (&library);
  if (error != FT_Err_Ok)
    return fail_freetype ("FT_Init_FreeType", error);

  error = FT_New_Face (library, argv[1], 0, &face);
  if (error != FT_Err_Ok)
    return fail_freetype ("FT_New_Face", error);

  error = FT_Set_Char_Size (face, 0, 16 * 64, 72, 72);
  if (error != FT_Err_Ok)
    return fail_freetype ("FT_Set_Char_Size", error);

  font = hb_ft_font_create_referenced (face);
  hb_font_get_scale (font, &x_scale, &y_scale);
  if (x_scale <= 0 || y_scale <= 0
      || !hb_font_get_nominal_glyph (font, 'A', &glyph))
    return fail ("the HarfBuzz FreeType font was not initialized");

  advance = hb_font_get_glyph_h_advance (font, glyph);
  if (advance <= 0)
    return fail ("the HarfBuzz FreeType callback returned no advance");

  if (check_shape (font, "ffi", HB_DIRECTION_LTR, NULL, 0, 1,
                   "the default Latin ligature did not form")
      != 0)
    return 1;

  if (!hb_feature_from_string ("liga=0", -1, &disable_ligatures))
    return fail ("the OpenType feature parser rejected liga=0");

  if (check_shape (font, "ffi", HB_DIRECTION_LTR, &disable_ligatures, 1, 3,
                   "disabling Latin ligatures did not restore three glyphs")
      != 0)
    return 1;

  if (check_shape (font, "سلام", HB_DIRECTION_RTL, NULL, 0, 3,
                   "Arabic shaping did not form the lam-alef ligature")
      != 0)
    return 1;

  hb_font_destroy (font);

  error = FT_Done_Face (face);
  if (error != FT_Err_Ok)
    return fail_freetype ("FT_Done_Face", error);

  error = FT_Done_FreeType (library);
  if (error != FT_Err_Ok)
    return fail_freetype ("FT_Done_FreeType", error);

  printf (
    "harfbuzz %s: Latin ligature, Arabic shaping and WASI file checks passed\n",
    hb_version_string ());
  return 0;
}
