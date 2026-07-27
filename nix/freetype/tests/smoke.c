#include <setjmp.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <ft2build.h>
#include FT_BBOX_H
#include FT_FONT_FORMATS_H
#include FT_FREETYPE_H
#include FT_OPENTYPE_VALIDATE_H
#include FT_OUTLINE_H
#include FT_TRUETYPE_TABLES_H

extern unsigned char fixture_font[];
extern unsigned int fixture_font_len;

struct outline_counts
{
  int moves;
  int lines;
  int conics;
  int cubics;
};

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
move_to (const FT_Vector *point, void *user)
{
  struct outline_counts *counts = user;

  (void) point;
  counts->moves++;
  return 0;
}

static int
line_to (const FT_Vector *point, void *user)
{
  struct outline_counts *counts = user;

  (void) point;
  counts->lines++;
  return 0;
}

static int
conic_to (const FT_Vector *control, const FT_Vector *point, void *user)
{
  struct outline_counts *counts = user;

  (void) control;
  (void) point;
  counts->conics++;
  return 0;
}

static int
cubic_to (const FT_Vector *control1, const FT_Vector *control2,
          const FT_Vector *point, void *user)
{
  struct outline_counts *counts = user;

  (void) control1;
  (void) control2;
  (void) point;
  counts->cubics++;
  return 0;
}

static int
check_setjmp (void)
{
  jmp_buf buffer;
  int value = setjmp (buffer);

  if (value == 0)
    longjmp (buffer, 23);

  return value == 23;
}

static void
free_validated_tables (FT_Face face, FT_Bytes base, FT_Bytes gdef,
                       FT_Bytes gpos, FT_Bytes gsub, FT_Bytes jstf)
{
  if (base != NULL)
    FT_OpenType_Free (face, base);
  if (gdef != NULL)
    FT_OpenType_Free (face, gdef);
  if (gpos != NULL)
    FT_OpenType_Free (face, gpos);
  if (gsub != NULL)
    FT_OpenType_Free (face, gsub);
  if (jstf != NULL)
    FT_OpenType_Free (face, jstf);
}

int
main (int argc, char **argv)
{
  FT_Library library;
  FT_Face face;
  FT_Face file_face;
  FT_UInt glyph_index;
  FT_BBox box;
  FT_Outline_Funcs outline_functions = {
    move_to,
    line_to,
    conic_to,
    cubic_to,
    0,
    0,
  };
  struct outline_counts counts = { 0 };
  FT_Bytes base = NULL;
  FT_Bytes gdef = NULL;
  FT_Bytes gpos = NULL;
  FT_Bytes gsub = NULL;
  FT_Bytes jstf = NULL;
  FT_ULong head_length = 0;
  FT_Byte *head;
  FT_Error error;
  const char *format;
  const char *postscript_name;
  FT_Int major;
  FT_Int minor;
  FT_Int patch;

  if (!check_setjmp ())
    return fail ("setjmp and longjmp did not preserve the return value");

  if (argc != 2)
    return fail ("expected one preopened font path");

  error = FT_Init_FreeType (&library);
  if (error != FT_Err_Ok)
    return fail_freetype ("FT_Init_FreeType", error);

  error = FT_New_Memory_Face (library, fixture_font, (FT_Long) fixture_font_len,
                              0, &face);
  if (error != FT_Err_Ok)
    return fail_freetype ("FT_New_Memory_Face", error);

  error = FT_New_Face (library, argv[1], 0, &file_face);
  if (error != FT_Err_Ok)
    return fail_freetype ("FT_New_Face", error);

  if (file_face->family_name == NULL
      || strcmp (file_face->family_name, "TeX Gyre Cursor") != 0)
    return fail ("the file-backed font metadata did not match");

  error = FT_Done_Face (file_face);
  if (error != FT_Err_Ok)
    return fail_freetype ("FT_Done_Face for file-backed font", error);

  format = FT_Get_Font_Format (face);
  postscript_name = FT_Get_Postscript_Name (face);
  if (face->family_name == NULL
      || strcmp (face->family_name, "TeX Gyre Cursor") != 0
      || face->style_name == NULL || strcmp (face->style_name, "Regular") != 0
      || postscript_name == NULL
      || strcmp (postscript_name, "TeXGyreCursor-Regular") != 0
      || format == NULL || strcmp (format, "CFF") != 0
      || face->num_faces != 1 || face->num_glyphs != 1087
      || face->units_per_EM != 1000)
    return fail ("font metadata did not match TeX Gyre Cursor");

  glyph_index = FT_Get_Char_Index (face, 'A');
  if (glyph_index != 28)
    return fail ("the glyph index for A did not match");

  error = FT_Load_Glyph (face, glyph_index, FT_LOAD_NO_SCALE);
  if (error != FT_Err_Ok)
    return fail_freetype ("FT_Load_Glyph", error);

  if (face->glyph->format != FT_GLYPH_FORMAT_OUTLINE
      || face->glyph->metrics.width != 582
      || face->glyph->metrics.height != 563
      || face->glyph->metrics.horiBearingX != 9
      || face->glyph->metrics.horiBearingY != 563
      || face->glyph->metrics.horiAdvance != 600
      || face->glyph->outline.n_contours != 2
      || face->glyph->outline.n_points != 47)
    return fail ("the unscaled glyph metrics or outline did not match");

  error = FT_Outline_Get_BBox (&face->glyph->outline, &box);
  if (error != FT_Err_Ok)
    return fail_freetype ("FT_Outline_Get_BBox", error);

  if (box.xMin != 9 || box.yMin != 0 || box.xMax != 591 || box.yMax != 563)
    return fail ("the glyph outline bounding box did not match");

  error = FT_Outline_Decompose (&face->glyph->outline, &outline_functions,
                                &counts);
  if (error != FT_Err_Ok)
    return fail_freetype ("FT_Outline_Decompose", error);

  if (counts.moves != 2 || counts.lines != 17 || counts.conics != 0
      || counts.cubics != 10)
    return fail ("the glyph outline commands did not match");

  error
    = FT_Load_Sfnt_Table (face, FT_MAKE_TAG ('h', 'e', 'a', 'd'), 0, NULL,
                          &head_length);
  if (error != FT_Err_Ok || head_length == 0)
    return fail_freetype ("FT_Load_Sfnt_Table size query", error);

  head = malloc (head_length);
  if (head == NULL)
    return fail ("could not allocate the SFNT table buffer");

  error
    = FT_Load_Sfnt_Table (face, FT_MAKE_TAG ('h', 'e', 'a', 'd'), 0, head,
                          &head_length);
  free (head);
  if (error != FT_Err_Ok)
    return fail_freetype ("FT_Load_Sfnt_Table", error);

  error = FT_OpenType_Validate (face, FT_VALIDATE_OT, &base, &gdef, &gpos,
                                &gsub, &jstf);
  if (error != FT_Err_Ok)
    return fail_freetype ("FT_OpenType_Validate", error);

  free_validated_tables (face, base, gdef, gpos, gsub, jstf);

  FT_Library_Version (library, &major, &minor, &patch);

  error = FT_Done_Face (face);
  if (error != FT_Err_Ok)
    return fail_freetype ("FT_Done_Face", error);

  error = FT_Done_FreeType (library);
  if (error != FT_Err_Ok)
    return fail_freetype ("FT_Done_FreeType", error);

  printf ("freetype %d.%d.%d: CFF outline and validation checks passed\n",
          major, minor, patch);
  return 0;
}
