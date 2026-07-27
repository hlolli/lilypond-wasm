#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define PCRE2_CODE_UNIT_WIDTH 8
#include <pcre2.h>

static int
fail (const char *message)
{
  fprintf (stderr, "%s\n", message);
  return 1;
}

int
main (void)
{
  static const PCRE2_UCHAR pattern[]
    = "^(?<latin>\\p{Latin}+)\\s+(?<greek>\\p{Greek}+)$";
  static const PCRE2_UCHAR subject[] = "Lily μουσική";
  int error_code;
  PCRE2_SIZE error_offset;
  PCRE2_SIZE *offsets;
  PCRE2_UCHAR *greek = NULL;
  PCRE2_SIZE greek_length = 0;
  pcre2_code *regex;
  pcre2_match_data *match;
  int result;

  regex = pcre2_compile (pattern, PCRE2_ZERO_TERMINATED,
                         PCRE2_UTF | PCRE2_UCP, &error_code, &error_offset,
                         NULL);
  if (regex == NULL)
    return fail ("pcre2_compile failed");

  match = pcre2_match_data_create_from_pattern (regex, NULL);
  if (match == NULL)
    return fail ("pcre2_match_data_create_from_pattern failed");

  result = pcre2_match (regex, subject, PCRE2_ZERO_TERMINATED, 0, 0, match,
                        NULL);
  if (result != 3)
    return fail ("the Unicode pattern did not produce three captures");

  offsets = pcre2_get_ovector_pointer (match);
  if (offsets[0] != 0 || offsets[1] != sizeof (subject) - 1)
    return fail ("the full-match offsets did not cover the subject");

  result = pcre2_substring_get_byname (match, (PCRE2_SPTR) "greek", &greek,
                                       &greek_length);
  if (result != 0 || greek_length != strlen ("μουσική")
      || memcmp (greek, "μουσική", greek_length) != 0)
    return fail ("the named Greek capture did not match");

  pcre2_substring_free (greek);
  pcre2_match_data_free (match);
  pcre2_code_free (regex);

  printf ("pcre2 %d.%d: UTF-8 matching and captures passed\n", PCRE2_MAJOR,
          PCRE2_MINOR);
  return 0;
}
