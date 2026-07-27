#include <stdio.h>
#include <string.h>

#include <zlib.h>

static int
zlib_error (const char *step, int status)
{
  fprintf (stderr, "%s failed with zlib status %d\n", step, status);
  return 1;
}

int
main (void)
{
  static const Bytef source[]
    = "(quote ((LilyPond . WASI) (compression . zlib)))";
  Bytef compressed[256];
  Bytef restored[sizeof (source)];
  uLongf compressed_size = sizeof (compressed);
  z_stream stream;
  int status;

  status = compress2 (compressed, &compressed_size, source, sizeof (source),
                      Z_BEST_COMPRESSION);
  if (status != Z_OK)
    return zlib_error ("compress2", status);

  memset (&stream, 0, sizeof (stream));
  status = inflateInit (&stream);
  if (status != Z_OK)
    return zlib_error ("inflateInit", status);

  stream.next_in = compressed;
  stream.avail_in = (uInt) compressed_size;
  stream.next_out = restored;
  stream.avail_out = sizeof (restored);

  status = inflate (&stream, Z_NO_FLUSH);
  if (status != Z_STREAM_END)
    {
      inflateEnd (&stream);
      return zlib_error ("inflate", status);
    }

  status = inflateEnd (&stream);
  if (status != Z_OK)
    return zlib_error ("inflateEnd", status);

  if (stream.total_out != sizeof (source)
      || memcmp (source, restored, sizeof (source)) != 0)
    {
      fputs ("inflate output did not match the input\n", stderr);
      return 1;
    }

  printf ("zlib %s: inflate round trip passed\n", zlibVersion ());
  return 0;
}
