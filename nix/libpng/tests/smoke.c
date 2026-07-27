#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <png.h>

static int
smoke_error (const char *step, const png_image *image)
{
  fprintf (stderr, "%s failed: %s\n", step, image->message);
  return 1;
}

int
main (void)
{
  static const png_byte pixels[] = {
    255, 0,   0,   255,
    0,   255, 0,   192,
    0,   0,   255, 128,
    255, 255, 255, 0,
  };
  static const png_byte invalid_png[] = { 0x89, 'P', 'N', 'G', 0 };
  png_byte restored[sizeof (pixels)];
  png_alloc_size_t encoded_size = 0;
  png_image writer = { 0 };
  png_image reader = { 0 };
  png_image invalid = { 0 };
  png_bytep encoded;

  writer.version = PNG_IMAGE_VERSION;
  writer.width = 2;
  writer.height = 2;
  writer.format = PNG_FORMAT_RGBA;

  if (!png_image_write_to_memory (&writer, NULL, &encoded_size, 0, pixels, 0,
                                  NULL))
    return smoke_error ("PNG size query", &writer);

  encoded = malloc (encoded_size);
  if (encoded == NULL)
    {
      fputs ("PNG buffer allocation failed\n", stderr);
      return 1;
    }

  if (!png_image_write_to_memory (&writer, encoded, &encoded_size, 0, pixels,
                                  0, NULL))
    {
      free (encoded);
      return smoke_error ("PNG memory write", &writer);
    }

  png_image_free (&writer);

  reader.version = PNG_IMAGE_VERSION;
  if (!png_image_begin_read_from_memory (&reader, encoded, encoded_size))
    {
      free (encoded);
      return smoke_error ("PNG memory read", &reader);
    }

  reader.format = PNG_FORMAT_RGBA;
  if (!png_image_finish_read (&reader, NULL, restored, 0, NULL))
    {
      free (encoded);
      return smoke_error ("PNG decode", &reader);
    }

  free (encoded);

  if (reader.width != 2 || reader.height != 2
      || memcmp (pixels, restored, sizeof (pixels)) != 0)
    {
      png_image_free (&reader);
      fputs ("decoded PNG did not match the input\n", stderr);
      return 1;
    }

  png_image_free (&reader);

  invalid.version = PNG_IMAGE_VERSION;
  if (png_image_begin_read_from_memory (&invalid, invalid_png,
                                        sizeof (invalid_png)))
    {
      png_image_free (&invalid);
      fputs ("invalid PNG was accepted\n", stderr);
      return 1;
    }

  png_image_free (&invalid);
  printf ("libpng %s: memory PNG and setjmp checks passed\n",
          PNG_LIBPNG_VER_STRING);
  return 0;
}
